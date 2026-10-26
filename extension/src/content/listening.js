import { readTransportDom, commandTransport, setSpotifyVolume } from './transport.js';
import { sendLocalMessage, writeTrackArtifact } from './storage.js';
import { withTrackMetadata } from './trackMetadata.js';
import { StemClock } from './stemClock.js';

export function createListeningController({ bridge, emit, ensurePlayer, getRunner, getTrackIds = () => [], getTrackMetadata = () => null }) {
  let busy = false, disposed = false, owner = false, lastLease = 0, catalogAt = 0;
  let enabled = false, activation = Promise.resolve();
  let halted = false, customPlayback = false, syncPending = 0, syncSettlesAt = 0;
  let catalog = new Map(), recording = null, last = null, generation = 0, lastSource = '';
  let volume = 0, output = 'muted', error = '', armed = false;
  let volumeTimer = null, volumeEdit = 0, volumeSettlesAt = 0, latestState = null;
  const stemClock = new StemClock();
  let pendingRate = null, rateQueued = false;
  let batchPending = false, silentGeneration = -1, replayPreparation = false;
  let frameHeartbeat = 0, failedTrack = '', ignoreUntil = 0, commands = Promise.resolve();
  let lastVolumeDom = null;
  let storageQueue = Promise.resolve();
  const storing = new Set();
  const policy = gain => bridge.command('listening-output', { gain: halted ? 0 : gain });
  const publish = state => { latestState = state; emit(state); };
  function changeVolume(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    volume = value; volumeEdit++; volumeSettlesAt = Date.now() + 300;
    if (latestState) publish({ ...latestState, volume });
    if (volumeTimer !== null) return;
    volumeTimer = setTimeout(() => {
      volumeTimer = null;
      if (!enabled || disposed) return;
      try {
        setSpotifyVolume(volume);
        lastVolumeDom = readTransportDom().volume;
        // Retain the capture/stems silence handshake; a volume gesture alone
        // must never unmute an idle player or change captured PCM amplitude.
        const gain = output === 'capture' && silentGeneration === generation &&
          Date.now() - frameHeartbeat < 2000 ? volume : 0;
        void policy(gain).catch(reason => { error = reason?.message || String(reason); });
      } catch (reason) { console.debug('[ktv420] Spotify volume sync unavailable', reason); }
    }, 32);
  }
  async function finish(valid) {
    const capture = recording ? withTrackMetadata(recording, getTrackMetadata(recording.trackId)) : null; recording = null;
    if (!capture) return;
    if (!valid || !capture.complete || catalog.has(capture.trackId)) { await bridge.command('capture-abort'); return; }
    const result = await bridge.command('capture-finish', {}, 60000);
    const bytes = new Uint8Array(result.bytesBuffer || new ArrayBuffer(0));
    const seconds = bytes.byteLength / (result.sampleRate * result.channelCount * 4);
    const expected = capture.duration - result.startMediaTime;
    // Never publish a partial recording or a recording padded by a long pause.
    if (result.invalid || result.startMediaTime > 0.35 || Math.abs(seconds - expected) > 0.45 || seconds < 0.1) return;
    storing.add(capture.trackId);
    storageQueue = storageQueue.then(() => writeTrackArtifact(capture.trackId, bytes, {
      storageVersion: 3, trackId: capture.trackId, trackName: capture.title, trackArtist: capture.artist,
      trackArtworkSrc: capture.artwork, audioSampleRate: result.sampleRate, audioChannelCount: result.channelCount,
      audioChannelLayout: 'interleaved', audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes.byteLength,
      crop: `${result.startMediaTime.toFixed(3)}-0`,
    })).catch(reason => { error = `Could not save ${capture.title}: ${reason?.message || reason}`; }).finally(() => { storing.delete(capture.trackId); catalogAt = 0; });
  }
  async function tick() {
    if (!enabled || busy || disposed) return;
    busy = true;
    const observedVolumeEdit = volumeEdit;
    try {
      const dom = readTransportDom();
      if (!dom.trackId && dom.playing && dom.available) {
        const opener = document.querySelector('[data-testid="cover-art-button"][aria-label="Now playing view"]');
        if (opener && !document.querySelector('#Desktop_PanelContainer_Id a[href*="uri="]')) opener.click();
      }
      const page = await bridge.command('listening-state');
      const media = page.media;
      // A stop cannot re-arm from the same still-playing DOM snapshot. Remote
      // playback may take over again only after we actually observe a pause.
      if (halted && !dom.playing && media?.paused) halted = false;
      const local = !!media && media.readyState >= 2 && (media.paused || Math.abs(media.currentTime - dom.position) < 2);
      const now = Date.now();
      if (local && dom.playing && !media.paused && (now - lastLease > 900 || !owner)) {
        owner = await sendLocalMessage({ type: 'ktv420:listening-claim' }); lastLease = now;
      }
      if (!local) owner = false;
      if (now - catalogAt > 2000) {
        const list = await sendLocalMessage({ type: 'ktv420:library-status' });
        catalog = new Map(list.map(item => [item.trackId, item.status])); catalogAt = now;
      }
      if (observedVolumeEdit === volumeEdit && now >= volumeSettlesAt) {
        // Media-element mutes also come from Spotify's track handoff and Canvas
        // videos. Only the visible Spotify volume control represents user intent.
        if (dom.volume !== null && dom.volume !== lastVolumeDom) volume = dom.volume;
      }
      lastVolumeDom = dom.volume;
      const changed = last && (dom.trackId !== last.trackId || (media?.source && lastSource && media.source !== lastSource));
      const delta = last ? dom.position - last.position : 0;
      const elapsed = last ? (now - last.observedAt) / 1000 : 0;
      const seeked = !!last && !changed && (delta < -0.5 || delta > elapsed * (last.playbackRate || 1) + 1.3);
      if (changed || seeked) { generation++; ignoreUntil = 0; }
      const runner = getRunner();
      const batch = runner?.isActive();
      if (recording && recording.trackId === dom.trackId) {
        recording = withTrackMetadata({ ...recording,
          title: recording.title || dom.title, artist: recording.artist || dom.artist,
          artwork: recording.artwork || dom.artwork,
        }, getTrackMetadata(recording.trackId));
      }
      // A captured end is authoritative even if the last progress poll was early.
      // Let the batch finish/save it instead of treating normal auto-advance as a remote skip.
      if (batch && runner.captureProgress && !page.captureEnded && (seeked || (changed && runner.captureProgress.fraction < 0.97))) runner.handoff();
      if (recording && !batch && (changed || seeked || !local || !owner || page.captureInvalid || media?.ended || page.captureEnded)) {
        const ended = !seeked && !page.captureInvalid && (page.captureEnded || media?.ended || (changed && last?.duration > 0 && last.position >= last.duration - 0.06));
        await finish(ended); if (ended && !changed) ignoreUntil = now + 700;
      }
      const ready = catalog.get(dom.trackId) === 'ready' && failedTrack !== dom.trackId;
      if (ready && recording && !batch) await finish(false);
      if (changed) failedTrack = '';
      if (dom.playing && !dom.trackId) error = 'Open Spotify’s Now Playing view to identify this song.';
      else if (error === 'Open Spotify’s Now Playing view to identify this song.') error = '';
      if (changed || batch || !ready || !owner || now - frameHeartbeat >= 2000) stemClock.reset();
      if (media && media.playbackRate !== 1) {
        error = 'Spotify must play at normal speed. Tempo belongs to the ktv420 player.';
        if (dom.playing) await commandTransport({action:'pause'});
      }
      const playing = !!(!halted && owner && local && dom.trackId && dom.playing && !media.paused && !media.ended && media.playbackRate === 1 && !error);
      stemClock.observe(local ? media.currentTime : dom.position, playing, seeked);
      if (playing) { armed = true; ensurePlayer(); }
      // Start the PCM tap while the player loads, so a cold iframe does not
      // discard the beginning of a newly selected song. Monitoring still waits
      // for the hosted player's explicit silence acknowledgment below.
      if (playing && armed && !replayPreparation && !customPlayback && !batch && !ready && !batchPending && now > ignoreUntil && !recording) {
        const result = await bridge.command('capture-begin');
        recording = withTrackMetadata({ ...dom, complete: result.target.currentTime <= 0.35 && !catalog.has(dom.trackId) && !storing.has(dom.trackId) }, getTrackMetadata(dom.trackId));
      }
      const connected = now - frameHeartbeat < 2000;
      const previousOutput = output;
      output = 'muted';
      if (playing && armed && connected) {
        if (batch) output = 'capture';
        else if (ready) output = 'stems';
        else if (recording && !batchPending && now > ignoreUntil) output = 'capture';
      }
      if (previousOutput !== output) generation++;
      const current = readTransportDom();
      if (current.trackId !== dom.trackId || current.playing !== dom.playing) { await policy(0); return; }
      // Playback is acknowledged only after the capture output is silenced.
      await policy(output === 'capture' && silentGeneration === generation ? volume : 0);
      if (stemClock.active && output === 'stems' && playing && dom.duration > 0) {
        if (stemClock.position >= dom.duration) {
          await commandTransport({ action: dom.canNext ? 'next' : 'pause' });
          return;
        }
      }
      last = { ...dom, playbackRate: 1, observedAt: Date.now() };
      lastSource = media?.source || '';
      const playlist = [...new Set(getTrackIds())];
      const scope = playlist.includes(dom.trackId) ? playlist : [dom.trackId];
      const captured = scope.filter(id => catalog.has(id)).length;
      const saving = scope.filter(id => !catalog.has(id) && storing.has(id)).length * .99;
      const partial = recording?.complete && !catalog.has(dom.trackId) && dom.duration > 0 ? Math.min(.99, dom.position / dom.duration) : 0;
      const overallCaptureFraction = recording && scope.length ? (captured + saving + partial) / scope.length : null;
      publish({ ...dom, overallCaptureFraction, generation, position: stemClock.active ? Math.min(dom.duration, stemClock.position) : local ? media.currentTime : dom.position, observedAt: Date.now(),
        playing: playing && connected, local: owner && local, output, volume, error,
        syncing: syncPending > 0 || now < syncSettlesAt,
        capability: 1, tempoSupported: true, playbackRate: stemClock.active ? stemClock.rate : 1, capturing: !!recording || !!batch,
        captureProgress: recording ? { trackId: recording.trackId, fraction: dom.duration > 0 ? Math.min(.99, dom.position / dom.duration) : null } : null,
      });
    } catch (reason) {
      error = reason?.message || String(reason); output = 'muted';
      await policy(0).catch(() => {});
      publish({ capability: 1, trackId: '', generation: ++generation, position: 0, duration: 0, playing: false, local: false, output: 'muted', volume, observedAt: Date.now(), error });
    } finally { busy = false; }
  }
  const timer = setInterval(() => void tick(), 200);
  void tick();
  return {
    setEnabled(value) {
      // Serialize fast open/close actions. Disable new ticks immediately, then
      // let an in-flight tick finish before releasing the page's audio routing.
      enabled = false;
      clearTimeout(volumeTimer); volumeTimer = null; volumeEdit++;
      activation = activation.catch(() => {}).then(async () => {
        while (busy) await new Promise(resolve => setTimeout(resolve, 20));
        try { if (!value) await finish(false); }
        finally { await bridge.command('listening-enable', { enabled: value }); }
        owner = false; lastLease = 0; last = null; lastSource = ''; error = '';
        lastVolumeDom = readTransportDom().volume;
        volume = replayPreparation ? 0 : lastVolumeDom ?? 0;
        volumeSettlesAt = 0; latestState = null;
        output = 'muted'; armed = false; stemClock.reset(); silentGeneration = -1; generation++;
        halted = false; customPlayback = false;
        enabled = value && !disposed;
        if (enabled) void tick();
      });
      return activation;
    },
    prepareReplay(value = true) { replayPreparation = value; if (value) volume = 0; if (enabled) void policy(0); },
    isCapturing() { return output === 'capture'; },
    heartbeat() { frameHeartbeat = Date.now(); },
    command(command) {
      if (!enabled) return Promise.resolve();
      if (command.action === 'volume') { changeVolume(command.volume); return Promise.resolve(); }
      if (command.action === 'rate') { pendingRate=command; if (rateQueued) return commands; rateQueued=true; }
      const bestEffort = command.bestEffort === true;
      if (bestEffort) { syncPending++; customPlayback = true; }
      commands = commands.catch(() => {}).then(async () => {
        if (!enabled) return;
        if (command.action === 'rate') { command=pendingRate; pendingRate=null; rateQueued=false; }
        if (command.action === 'silenced') { if (command.generation === generation) silentGeneration = generation; return; }
        error = '';
        if (command.action === 'stems-failed') { failedTrack = command.trackId; return; }
        if (command.action === 'enable') { armed = true; ensurePlayer(); return; }
        if (command.action === 'play' || command.action === 'select') halted = false;
        if (command.action === 'rate') {
          const dom = readTransportDom();
          if (!Number.isFinite(command.rate) || command.rate < .5 || command.rate > 1.5 || dom.trackId !== command.trackId || catalog.get(dom.trackId) !== 'ready' || recording || getRunner()?.isActive()) throw new Error('Tempo changes require prepared stems. Capture stays at 1×.');
          while (busy) await new Promise(resolve => setTimeout(resolve,20));
          busy = true;
          try {
            const current = readTransportDom();
            if (current.trackId !== command.trackId) throw new Error('The song changed before setting tempo.');
            const page = await bridge.command('listening-state');
            if (readTransportDom().trackId !== command.trackId || !page.media || page.media.playbackRate !== 1) throw new Error('Spotify playback changed before setting tempo.');
            stemClock.setRate(command.rate, page.media.currentTime, current.playing && !page.media.paused);
          }
          finally { busy=false; }
          return;
        }
        getRunner()?.handoff();
        if (bestEffort) {
          stemClock.reset();
          await policy(0);
          if (recording) await finish(false);
        }
        if (command.action !== 'pause' && command.action !== 'play') {
          await policy(0); generation++;
          if (recording) await finish(false);
        }
        await commandTransport(command);
        if (command.action === 'seek') {
          const page = await bridge.command('listening-state');
          if (!page.media || Math.abs(page.media.currentTime - command.position) > 1.5) throw new Error('Spotify did not apply the requested seek to its local audio.');
          stemClock.observe(page.media.currentTime, !page.media.paused, true);
        }
      }).catch(reason => {
        if (bestEffort) console.debug('[ktv420] Spotify sync unavailable', reason);
        else error = reason?.message || String(reason);
      }).finally(() => {
        if (bestEffort) { syncPending--; syncSettlesAt = Date.now() + 1000; }
      });
      return commands;
    },
    async stopCapture() {
      halted = true; armed = false; output = 'muted'; generation++;
      if (latestState) publish({ ...latestState, generation, playing: false, output: 'muted', capturing: false,
        captureProgress: null, overallCaptureFraction: null });
      await policy(0);
      try { await commandTransport({ action: 'pause' }); }
      finally {
        while (busy) await new Promise(resolve => setTimeout(resolve, 20));
        await finish(false);
      }
    },
    afterBatch() { batchPending = false; },
    async beforeBatch() { customPlayback = false; batchPending = true; halted = false; stemClock.reset(); while (busy) await new Promise(resolve => setTimeout(resolve, 20)); await finish(false); last = null; lastSource = ''; },
    dispose() { disposed = true; clearInterval(timer); if (enabled) void this.setEnabled(false).catch(() => {}); },
  };
}

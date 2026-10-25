import { readTransportDom, commandTransport } from './transport.js';
import { sendLocalMessage, writeTrackArtifact } from './storage.js';

export function createListeningController({ bridge, emit, ensurePlayer, getRunner, getTrackIds = () => [] }) {
  let busy = false, disposed = false, owner = false, lastLease = 0, catalogAt = 0;
  let enabled = false, activation = Promise.resolve();
  let catalog = new Map(), recording = null, last = null, generation = 0, lastSource = '';
  let volume = 0.7, volumeRevision = -1, output = 'muted', error = '', armed = false;
  let desiredRate = 1, pendingRate = null, rateQueued = false;
  let batchPending = false, silentGeneration = -1, replayPreparation = false;
  let frameHeartbeat = 0, failedTrack = '', ignoreUntil = 0, commands = Promise.resolve();
  let lastVolumeDom = null;
  let storageQueue = Promise.resolve();
  const storing = new Set();
  const policy = gain => bridge.command('listening-output', { gain });
  async function finish(valid) {
    const capture = recording; recording = null;
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
    try {
      let dom = readTransportDom();
      if (!dom.trackId && dom.playing && dom.available) {
        const opener = document.querySelector('[data-testid="cover-art-button"][aria-label="Now playing view"]');
        if (opener && !document.querySelector('#Desktop_PanelContainer_Id a[href*="uri="]')) opener.click();
      }
      const page = await bridge.command('listening-state');
      const media = page.media;
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
      if (volumeRevision < 0) volumeRevision = page.volumeRevision;
      if (page.volumeRevision !== volumeRevision) { volume = page.requestedVolume; volumeRevision = page.volumeRevision; }
      if (lastVolumeDom !== null && dom.volume !== null && dom.volume !== lastVolumeDom) volume = dom.volume;
      lastVolumeDom = dom.volume;
      const changed = last && (dom.trackId !== last.trackId || (media?.source && lastSource && media.source !== lastSource));
      const delta = last ? dom.position - last.position : 0;
      const elapsed = last ? (now - last.observedAt) / 1000 : 0;
      const seeked = !!last && !changed && (delta < -0.5 || delta > elapsed * (last.playbackRate || 1) + 1.3);
      if (changed || seeked) { generation++; ignoreUntil = 0; }
      const runner = getRunner();
      const batch = runner?.isActive();
      if (batch && (seeked || (changed && runner.captureProgress && runner.captureProgress.fraction < 0.97))) runner.handoff();
      if (recording && !batch && (changed || seeked || !local || !owner || page.captureInvalid || media?.ended || page.captureEnded)) {
        const ended = !seeked && !page.captureInvalid && (page.captureEnded || media?.ended || (changed && last?.duration > 0 && last.position >= last.duration - 0.06));
        await finish(ended); if (ended && !changed) ignoreUntil = now + 700;
      }
      const ready = catalog.get(dom.trackId) === 'ready' && failedTrack !== dom.trackId;
      if (ready && recording && !batch) await finish(false);
      if (changed) failedTrack = '';
      if (dom.playing && !dom.trackId) error = 'Open Spotify’s Now Playing view to identify this song.';
      else if (error === 'Open Spotify’s Now Playing view to identify this song.') error = '';
      if (changed || batch || !ready || !owner || now - frameHeartbeat >= 2000) {
        desiredRate = 1;
        if (media && media.playbackRate !== 1) {
          await bridge.command('listening-rate', {rate:1,reset:true});
          media.playbackRate = 1;
        }
      }
      if (media && media.playbackRate !== desiredRate) {
        error = 'Spotify reset the tempo. Pause and choose the tempo again.';
        if (dom.playing) await commandTransport({action:'pause'});
      }
      const playing = !!(owner && local && dom.trackId && dom.playing && !media.paused && !media.ended && media.playbackRate === desiredRate && !error);
      if (playing) { armed = true; ensurePlayer(); }
      // Start the PCM tap while the player loads, so a cold iframe does not
      // discard the beginning of a newly selected song. Monitoring still waits
      // for the hosted player's explicit silence acknowledgment below.
      if (playing && armed && !replayPreparation && !batch && !ready && !batchPending && now > ignoreUntil && !recording) {
        const result = await bridge.command('capture-begin');
        recording = { ...dom, complete: result.target.currentTime <= 0.35 && !catalog.has(dom.trackId) && !storing.has(dom.trackId) };
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
      last = { ...dom, playbackRate: media?.playbackRate ?? 1, observedAt: now };
      lastSource = media?.source || '';
      const playlist = [...new Set(getTrackIds())];
      const scope = playlist.includes(dom.trackId) ? playlist : [dom.trackId];
      const captured = scope.filter(id => catalog.has(id)).length;
      const saving = scope.filter(id => !catalog.has(id) && storing.has(id)).length * .99;
      const partial = recording?.complete && !catalog.has(dom.trackId) && dom.duration > 0 ? Math.min(.99, dom.position / dom.duration) : 0;
      const overallCaptureFraction = recording && scope.length ? (captured + saving + partial) / scope.length : null;
      emit({ ...dom, overallCaptureFraction, generation, position: local ? media.currentTime : dom.position, observedAt: Date.now(),
        playing: playing && connected, local: owner && local, output, volume, error,
        capability: 1, tempoSupported: true, playbackRate: media?.playbackRate ?? 1, capturing: !!recording || !!batch,
        captureProgress: recording ? { trackId: recording.trackId, fraction: dom.duration > 0 ? Math.min(.99, dom.position / dom.duration) : null } : null,
      });
    } catch (reason) {
      error = reason?.message || String(reason); output = 'muted';
      await policy(0).catch(() => {});
      emit({ capability: 1, trackId: '', generation: ++generation, position: 0, duration: 0, playing: false, local: false, output: 'muted', volume, observedAt: Date.now(), error });
    } finally { busy = false; }
  }
  const timer = setInterval(() => void tick(), 200);
  void tick();
  return {
    setEnabled(value) {
      // Serialize fast open/close actions. Disable new ticks immediately, then
      // let an in-flight tick finish before releasing the page's audio routing.
      enabled = false;
      activation = activation.catch(() => {}).then(async () => {
        while (busy) await new Promise(resolve => setTimeout(resolve, 20));
        try { if (!value) await finish(false); }
        finally { await bridge.command('listening-enable', { enabled: value }); }
        owner = false; lastLease = 0; last = null; lastSource = ''; error = '';
        output = 'muted'; armed = false; desiredRate = 1; silentGeneration = -1; generation++;
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
      if (command.action === 'rate') { pendingRate=command; if (rateQueued) return commands; rateQueued=true; }
      commands = commands.catch(() => {}).then(async () => {
        if (!enabled) return;
        if (command.action === 'rate') { command=pendingRate; pendingRate=null; rateQueued=false; }
        if (command.action === 'silenced') { if (command.generation === generation) silentGeneration = generation; return; }
        error = '';
        if (command.action === 'volume') { if (Number.isFinite(command.volume) && command.volume >= 0 && command.volume <= 1) { volume = command.volume; await commandTransport(command); } return; }
        if (command.action === 'stems-failed') { failedTrack = command.trackId; return; }
        if (command.action === 'enable') { armed = true; ensurePlayer(); return; }
        if (command.action === 'rate') {
          const dom = readTransportDom();
          if (!Number.isFinite(command.rate) || command.rate < .5 || command.rate > 1.5 || dom.trackId !== command.trackId || catalog.get(dom.trackId) !== 'ready' || recording || getRunner()?.isActive()) throw new Error('Tempo changes require prepared stems. Capture stays at 1×.');
          while (busy) await new Promise(resolve => setTimeout(resolve,20));
          busy = true;
          try {
            if (readTransportDom().trackId !== command.trackId) throw new Error('The song changed before setting tempo.');
            await policy(0); await bridge.command('listening-rate',{rate:command.rate}); desiredRate=command.rate;
          }
          finally { busy=false; }
          return;
        }
        getRunner()?.handoff();
        if (command.action !== 'pause' && command.action !== 'play') {
          await policy(0); generation++;
          if (recording) await finish(false);
        }
        await commandTransport(command);
        if (command.action === 'seek') {
          const page = await bridge.command('listening-state');
          if (!page.media || Math.abs(page.media.currentTime - command.position) > 1.5) throw new Error('Spotify did not apply the requested seek to its local audio.');
        }
      }).catch(reason => { error = reason?.message || String(reason); });
      return commands;
    },
    async stopCapture() { await this.command({ action: 'pause' }); while (busy) await new Promise(resolve => setTimeout(resolve, 20)); await finish(false); },
    afterBatch() { batchPending = false; },
    async beforeBatch() { batchPending = true; desiredRate = 1; await bridge.command('listening-rate',{rate:1,reset:true}); while (busy) await new Promise(resolve => setTimeout(resolve, 20)); await finish(false); },
    dispose() { disposed = true; clearInterval(timer); if (enabled) void this.setEnabled(false).catch(() => {}); },
  };
}

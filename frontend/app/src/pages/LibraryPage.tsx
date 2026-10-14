import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Player from '../features/stems/player/Player';
import OverlayIcon from './OverlayIcon';
import type { PlaybackRecord, PlaybackRecording, RecordingEvent, RecordingStartRequest } from '../features/stems/player/types';
import { deleteTrack, getPlaybackRecord, listTracks, getProcessingEnabled, setProcessingEnabled as saveProcessingEnabled, withProcessingLock, type LocalTrack } from '../features/local/libraryClient';
import { downloadBlob } from '../features/local/importAudio';
import { processLocalTrack } from '../features/local/processing';
import { drainSpotifyQueue } from '../features/local/spotifyQueue';
import { nextSeparationFraction } from '../features/local/rowProgress';
import { useSpotifyOverlay } from '../features/local/useSpotifyOverlay';
import { LocalSeparator } from '../features/local/inference/client';
import { clearModelCache, getModelCacheStatus, loadModelBytes } from '../features/local/inference/model';
import type { SeparationProgress } from '../features/local/inference/types';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function LibraryPage() {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [selected, setSelected] = useState('');
  const [record, setRecord] = useState<PlaybackRecord | null>(null);
  const [viewMode, setViewMode] = useState<'tracks' | 'settings' | 'player'>('tracks');
  const content = useRef<HTMLDivElement>(null);
  const viewScroll = useRef({ tracks: 0, settings: 0, player: 0 });
  useLayoutEffect(() => { if (content.current) content.current.scrollTop = viewScroll.current[viewMode]; }, [viewMode]);
  const [error, setError] = useState('');
  const spotify = useSpotifyOverlay();
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [active, setActive] = useState('');
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [separationFraction, setSeparationFraction] = useState<number | null>(null);
  const [backend, setBackend] = useState<'auto' | 'wasm'>('auto');
  const [modelCached, setModelCached] = useState(false);
  const [modelAction, setModelAction] = useState<'download' | 'remove' | null>(null);
  const [modelDownload, setModelDownload] = useState(0);
  const modelBusy = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState(false);
  const deleting = useRef(false);
  const previousView = useRef<'tracks' | 'player'>('tracks');
  const [recording, setRecording] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const separator = useRef<LocalSeparator | null>(null);
  const running = useRef(false); const cancelled = useRef(false);
  const mix = useRef<PlaybackRecording | null>(null);
  const flush = useRef<(() => void) | null>(null);
  const savedSpotifyTracks = spotify.embedded
    ? spotify.tracks.flatMap(item => tracks.filter(track => track.id === `spotify-${item.trackId}`))
    : tracks.filter(track => track.source === 'spotify').slice().reverse();
  const playbackTracks = savedSpotifyTracks.filter(track => track.status === 'ready');
  const selectedIndex = playbackTracks.findIndex(track => track.id === selected);
  const activeTrack = tracks.find(track => track.id === selected);
  const observedProcessingPreference = useRef<boolean | null>(null);
  const refresh = useCallback(async () => {
    const [savedTracks, cached, enabled] = await Promise.all([listTracks(), getModelCacheStatus(), getProcessingEnabled()]);
    setTracks(savedTracks); setModelCached(cached); setAutoProcessing(enabled);
    if (observedProcessingPreference.current === true && !enabled) { cancelled.current = true; separator.current?.dispose(); }
    observedProcessingPreference.current = enabled;
  }, []);
  useEffect(() => {
    const update = () => { void refresh().catch(reason => setError(errorText(reason))); };
    update(); const timer = setInterval(update, 2500);
    return () => { clearInterval(timer); };
  }, [refresh]);
  useEffect(() => () => { cancelled.current = true; separator.current?.dispose(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (running.current || deleting.current || modelBusy.current || mix.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const selectedReady = activeTrack?.status === 'ready';
  const selectedCreatedAt = activeTrack?.createdAt;
  const loadedRevision = useRef('');
  useEffect(() => {
    let disposed = false;
    const revision = `${selected}/${selectedCreatedAt}/${selectedReady ? 'stems' : 'input'}`;
    if (recording || loadedRevision.current === revision) return;
    if (selected) void getPlaybackRecord(selected).then(next => {
      if (!disposed) { loadedRevision.current = revision; setRecord({ ...next, files: next.files.filter(file => file.name !== 'source') }); }
    }).catch(reason => { if (!disposed) setError(errorText(reason)); });
    return () => { disposed = true; };
  }, [selected, selectedReady, selectedCreatedAt, recording]);
  const processTracks = useCallback(async (ids: string[], automatic = false) => {
    if (running.current || deleting.current || modelBusy.current) return;
    running.current = true; cancelled.current = false; setError('');
    try {
      await withProcessingLock(async lock => {
        if (!lock) {
          if (!automatic) setError('Another ktv420 view is processing these captures.');
          return;
        }
        separator.current = new LocalSeparator(backend === 'wasm' ? { backend: 'wasm' } : {});
        const process = async (id: string) => {
          if (cancelled.current) return;
          setActive(id); setProgress(null); setSeparationFraction(null);
          try { await processLocalTrack(id, separator.current!, () => cancelled.current, value => {
            setProgress(value); setSeparationFraction(previous => nextSeparationFraction(previous, value));
          }); }
          finally { await refresh(); }
        };
        if (automatic) await drainSpotifyQueue({ list: listTracks, process,
          cancelled: () => cancelled.current,
          onError: reason => setError(errorText(reason)),
        });
        else for (const id of ids) { if (cancelled.current) break; await process(id); }
      });
    } catch (reason) { setError(errorText(reason)); }
    finally { separator.current?.dispose(); separator.current = null; running.current = false; setActive(''); setProgress(null); await refresh(); }
  }, [backend, refresh]);
  useEffect(() => {
    if (!autoProcessing) return;
    let disposed = false;
    const poll = async () => {
      if (running.current || deleting.current || modelBusy.current || disposed) return;
      try {
        const pending = await listTracks();
        if (!disposed && pending.some(track => track.source === 'spotify' && ['captured', 'processing'].includes(track.status))) {
          await processTracks([], true);
        }
      } catch (reason) { if (!disposed) setError(errorText(reason)); }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [autoProcessing, processTracks]);
  const setProcessingEnabled = (enabled: boolean) => {
    if (!enabled) { cancelled.current = true; separator.current?.dispose(); }
    void saveProcessingEnabled(enabled).then(() => { observedProcessingPreference.current = enabled; setAutoProcessing(enabled); }).catch(reason => setError(errorText(reason)));
  };
  const manageModel = async () => {
    if (modelBusy.current || running.current || deleting.current) return;
    modelBusy.current = true; setModelDownload(0); setError('');
    setModelAction(modelCached ? 'remove' : 'download');
    try {
      if (modelCached) await clearModelCache();
      else await loadModelBytes(setModelDownload, { requireCache: true });
    } catch (reason) { setError(errorText(reason)); }
    finally {
      await refresh().catch(reason => setError(errorText(reason)));
      modelBusy.current = false; setModelAction(null);
    }
  };
  const remove = async (id: string) => {
    try { await deleteTrack(id); if (selected === id) { setSelected(''); loadedRevision.current = ''; setRecord(null); } setConfirmDelete(''); await refresh(); }
    catch (reason) { setError(errorText(reason)); }
  };
  const removeAll = async () => {
    if (running.current || deleting.current || recording || spotify.active || spotify.starting) return;
    deleting.current = true; setDeletingAudio(true); setError('');
    try {
      // Reuse the installed broker's guarded delete operation; no extension update required.
      const saved = await listTracks();
      setSelected(''); setRecord(null); loadedRevision.current = ''; previousView.current = 'tracks';
      for (const track of saved) await deleteTrack(track.id);
      setConfirmDeleteAll(false); setConfirmDelete('');
    } catch (reason) { setError(`Could not delete all audio: ${errorText(reason)}`); }
    finally {
      deleting.current = false; setDeletingAudio(false);
      await refresh().catch(reason => setError(errorText(reason)));
    }
  };
  const toggleSettings = () => {
    setConfirmDelete(''); setConfirmDeleteAll(false);
    if (viewMode === 'settings') setViewMode(previousView.current);
    else {
      previousView.current = viewMode;
      setViewMode('settings');
    }
  };
  const recordEvent = useCallback((event: RecordingEvent) => { mix.current?.events.push(event); }, []);
  const startRecording = useCallback(async (request: RecordingStartRequest) => {
    const name = `ktv420-mix-${new Date().toISOString().replaceAll(':', '-')}`;
    mix.current = { version:1, name, createdAt:new Date().toISOString(), trackIds:[selected], events:[
      {type:'record_start_snapshot',trackTimeSeconds:request.trackTimeSeconds,payload:request.snapshotPayload},
      {type:'track_started',trackTimeSeconds:request.trackTimeSeconds,payload:{trackId:selected}},
    ] }; setRecording(true); return true;
  }, [selected]);
  const stopRecording = useCallback(async (event: RecordingEvent) => {
    if (!mix.current) return;
    flush.current?.(); mix.current.events.push(event);
    downloadBlob(new Blob([JSON.stringify(mix.current, null, 2)], {type:'application/json'}), `${mix.current.name}.json`);
    mix.current = null; setRecording(false);
  }, []);
  const navigateTrack = (offset: number) => {
    const next = playbackTracks[selectedIndex + offset];
    if (!next || recording) return;
    loadedRevision.current = ''; setRecord(null); setSelected(next.id); setAutoPlay(true);
  };
  const displayTracks: (Omit<LocalTrack, 'status'> & { status: LocalTrack['status'] | 'missing' })[] = spotify.embedded
    ? spotify.tracks.map(item => tracks.find(track => track.id === `spotify-${item.trackId}`) || {
      id: `spotify-${item.trackId}`, title: item.trackName, artist: item.trackArtist, createdAt: 0,
      status: 'missing', source: 'spotify', bytes: 0, frames: 0, sampleRate: 44100, metadata: { trackArtworkSrc: item.trackArtworkSrc },
    }) : savedSpotifyTracks;
  const close = useCallback(() => { setViewMode('tracks'); spotify.close(); }, [spotify]);
  const canCapture = spotify.embedded && !spotify.starting && !deletingAudio && (spotify.active || (spotify.supported && spotify.tracks.length > 0));
  const audioBusy = !!active || recording || spotify.active || spotify.starting || deletingAudio;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) return;
      if (event.key === 'Enter' && viewMode === 'tracks' && canCapture) { event.preventDefault(); spotify.toggleCapture(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [close, spotify, viewMode, canCapture]);
  const openTrack = (id: string) => {
    if (tracks.find(track => track.id === id)?.status !== 'ready' || deleting.current || (recording && selected !== id)) return;
    if (selected !== id) { loadedRevision.current = ''; setRecord(null); setSelected(id); setAutoPlay(false); viewScroll.current.player = 0; }
    setViewMode('player');
  };
  const stoppedByUser = !error && /^Capture run stopped by user\.?$/.test(spotify.error);
  const statusError = !!error || (!!spotify.error && !stoppedByUser);
  const statusMessage = error || (stoppedByUser ? 'Capture stopped.' : spotify.error) ||
    (spotify.starting ? 'Starting capture…' : spotify.active ? 'Capturing songs as they play…' :
      spotify.notice.replace(' Local separation is queued automatically.', '').replace(' Separation continues here automatically.', ''));
  return <main className="iframe-page iframe-page--overlay" aria-label="ktv420 iframe controls">
    <div className="iframe-status-slot">
      {statusMessage && <p className="iframe-status-message" data-kind={statusError ? 'error' : 'notice'} role={statusError ? 'alert' : 'status'}>
        <OverlayIcon name={statusError ? 'alert' : 'music'} /><span>{statusMessage}</span>
      </p>}
    </div>
    <div className="iframe-actions">
      <button type="button" className="iframe-close-button" aria-label="Close" title="Close" onClick={close}><OverlayIcon name="close" /></button>
      <button type="button" className="iframe-logo-button" aria-label="Start or stop ktv420 capture"
        title={spotify.active ? 'Stop capture' : 'Start capture'} aria-disabled={!canCapture} disabled={!canCapture}
        aria-pressed={spotify.active} onClick={spotify.toggleCapture}><img alt="" src="./favicon.svg" /></button>
      <button type="button" className="iframe-settings-button" aria-label="Toggle settings view" title={viewMode === 'settings' ? 'Back to music' : 'Settings'}
        aria-pressed={viewMode === 'settings'} onClick={toggleSettings}><OverlayIcon name="settings" /></button>
    </div>
    <div className="iframe-content" ref={content} onScroll={event => { viewScroll.current[viewMode] = event.currentTarget.scrollTop; }}>
    {viewMode === 'settings' && <section className="iframe-settings-view" aria-label="Settings view">
      <section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Separation</h2><span>On your computer</span></header>
        <p className="iframe-settings-help">Turn captured songs into vocals, drums, bass, and other sounds.</p>
        <div className="iframe-setting-row">
          <div><h3>Automatic separation</h3><p id="separation-help">Capture continues while paused. Unfinished songs restart on resume.</p></div>
          <button disabled={deletingAudio} aria-describedby="separation-help" onClick={() => setProcessingEnabled(!autoProcessing)}>{autoProcessing ? 'Pause separation' : 'Resume separation'}</button>
        </div>
        {active && <progress max={1} value={progress?.fraction || 0} aria-label="Separation progress" title={progress?.message} />}
        <div className="iframe-setting-row">
          <div><label htmlFor="separation-device">Processing device</label><p>Use CPU if GPU separation fails.</p></div>
          <select id="separation-device" value={backend} disabled={!!active || deletingAudio} onChange={event => setBackend(event.target.value as 'auto' | 'wasm')}>
            <option value="auto">GPU preferred</option><option value="wasm">CPU compatibility</option>
          </select>
        </div>
        <div className="iframe-setting-row">
          <div><h3>Demucs model</h3><p id="model-help">{modelCached ? '181 MB saved. Removing it keeps your songs.' : '181 MB download. Also downloads automatically when needed.'}</p></div>
          <button disabled={!!modelAction || !!active || deletingAudio} aria-describedby="model-help" onClick={() => void manageModel()}>
            {modelAction === 'download' ? (modelDownload >= 1 ? 'Finishing download…' : `Downloading ${Math.floor(modelDownload * 100)}%…`)
              : modelAction === 'remove' ? 'Removing model…' : modelCached ? 'Remove downloaded model' : 'Download model · 181 MB'}
          </button>
        </div>
      </section>
      <section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Local audio</h2><span>{size(tracks.reduce((total, track) => total + track.bytes, 0))}</span></header>
        <p className="iframe-settings-help">Saved songs and stems in this Chrome profile. Export anything you want to keep.</p>
        <div className="iframe-audio-cleanup">
          {confirmDeleteAll ? <>
            <span>Delete all saved songs and stems? This can’t be undone.</span>
            <button className="iframe-delete-all" disabled={audioBusy} onClick={() => void removeAll()}>{deletingAudio ? 'Deleting…' : 'Delete everything'}</button>
            <button disabled={deletingAudio} onClick={() => setConfirmDeleteAll(false)}>Cancel</button>
          </> : <button className="iframe-delete-all" disabled={!tracks.length || audioBusy} onClick={() => { setConfirmDelete(''); setConfirmDeleteAll(true); }}>Delete all audio</button>}
        </div>
        {audioBusy && !deletingAudio && <p className="iframe-settings-help">Stop capture, separation, and mix recording before deleting audio.</p>}
        {!tracks.length && <p className="iframe-settings-help">No saved audio.</p>}
        <ol className="iframe-settings-list">{tracks.map(track => <li key={track.id}>
          <div className="iframe-settings-row"><span className="iframe-settings-kind"><OverlayIcon name="music" /></span><span className="iframe-settings-path">{track.title}</span>
            <span className="iframe-settings-size">{size(track.bytes)}</span><span className="iframe-settings-row-actions">
              {track.status === 'error' && <button className="iframe-settings-icon-button" disabled={!!active || deletingAudio} title="Retry separation" aria-label={`Retry ${track.title}`} onClick={() => void processTracks([track.id])}><OverlayIcon name="retry" /></button>}
              {confirmDelete === track.id ? <><button disabled={audioBusy} onClick={() => void remove(track.id)}>Delete</button><button onClick={() => setConfirmDelete('')}>Cancel</button></> :
                <button className="iframe-settings-icon-button" disabled={audioBusy} title="Delete audio" aria-label={`Delete ${track.title}`} onClick={() => { setConfirmDeleteAll(false); setConfirmDelete(track.id); }}><OverlayIcon name="trash" /></button>}
            </span></div>
        </li>)}</ol>
      </section>
    </section>}
    {viewMode === 'tracks' && <ol className="iframe-track-list" aria-label="Spotify page tracks">
      {!displayTracks.length && <li className="iframe-playlist-empty">Open a Spotify playlist or album to get started.</li>}
      {displayTracks.map((track, index) => {
        const ready = track.status === 'ready';
        const available = ready && !deletingAudio && (!recording || selected === track.id);
        const capture = spotify.captureProgress?.trackId === track.id.replace(/^spotify-/, '') ? spotify.captureProgress : null;
        const separating = !ready && (active === track.id || track.status === 'processing');
        const progressKind = !ready && capture ? 'capture' : separating ? 'separation' : undefined;
        const fraction = progressKind === 'capture' ? capture!.fraction : active === track.id ? separationFraction : null;
        const label = ready ? 'Ready' : progressKind === 'capture' ? `Capturing${fraction === null ? '' : ` ${Math.floor(fraction * 100)}%`}`
          : separating ? `${active === track.id && progress?.phase === 'encoding' ? 'Saving MP3' : 'Separating'}${fraction === null ? '' : ` ~${Math.floor(fraction * 100)}%`}`
          : track.status === 'error' ? 'Failed' : track.status === 'missing' ? 'Not captured' : 'Queued';
        const icon = ready ? 'play' : track.status === 'error' ? 'alert' : progressKind ? 'processing' : 'clock';
        const artwork = typeof track.metadata?.trackArtworkSrc === 'string' ? track.metadata.trackArtworkSrc : '';
        return <li key={`${track.id}-${index}`}><button type="button" className="iframe-track-row" data-state={track.status} data-progress={progressKind}
          aria-label={`${track.title} — ${label}`} disabled={!available}
          title={track.error || (active === track.id ? progress?.message : available ? 'Open stem mixer' : label)}
          onClick={() => openTrack(track.id)}>
          {progressKind && <span className="iframe-track-fill" data-indeterminate={fraction === null} style={{ width: fraction === null ? '35%' : `${fraction * 100}%` }} aria-hidden="true" />}
          <span className="iframe-track-state"><OverlayIcon name={icon} /></span>
          {artwork ? <img className="iframe-track-artwork" alt="" src={artwork} crossOrigin="anonymous" /> : <span className="iframe-track-artwork iframe-artwork-placeholder"><OverlayIcon name="music" /></span>}
          <span className="iframe-track-copy"><span className="iframe-track-name">{track.title}</span><span className="iframe-track-artist">{track.artist}</span></span>
          <span className="iframe-track-status">{label}</span>
        </button></li>;
      })}
    </ol>}
    {activeTrack && record && record.md5 === selected && <section className="iframe-player-view" hidden={viewMode !== 'player'} aria-label="Player">
      <button className="iframe-player-back" aria-label="Back to tracks" onClick={() => setViewMode('tracks')}><OverlayIcon name="back" /></button>
      <Player record={record} title={activeTrack.title}
        hasPreviousTrack={!recording && selectedIndex > 0} hasNextTrack={!recording && selectedIndex >= 0 && selectedIndex < playbackTracks.length - 1}
        onPreviousTrack={() => navigateTrack(-1)} onNextTrack={() => navigateTrack(1)} onTrackEnd={() => navigateTrack(1)}
        autoPlayOnReady={autoPlay} onAutoPlayOnReadyHandled={() => setAutoPlay(false)} trackMetadata={activeTrack.metadata} isRecording={recording}
        onStartRecording={startRecording} onStopRecording={stopRecording} onRecordingEvent={recordEvent} onRegisterRecordingFlush={callback => { flush.current = callback; }} />
      <details className="iframe-player-exports"><summary>Export audio</summary>{record.files.map(file => <button key={file.path}
        onClick={() => downloadBlob(file.blob, `${activeTrack.title}-${file.name}`)}>{file.name.replace(/\.(wav|mp3)$/i, '')}</button>)}</details>
    </section>}
    </div>
  </main>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import Player from '../features/stems/player/Player';
import type { PlaybackRecord, PlaybackRecording, RecordingEvent, RecordingStartRequest } from '../features/stems/player/types';
import { deleteTrack, getPlaybackRecord, listTracks, getProcessingEnabled, setProcessingEnabled as saveProcessingEnabled, withProcessingLock, type LocalTrack } from '../features/local/libraryClient';
import { downloadBlob } from '../features/local/importAudio';
import { processLocalTrack } from '../features/local/processing';
import { drainSpotifyQueue } from '../features/local/spotifyQueue';
import { useSpotifyOverlay } from '../features/local/useSpotifyOverlay';
import { LocalSeparator } from '../features/local/inference/client';
import { clearModelCache, getModelCacheStatus } from '../features/local/inference/model';
import type { SeparationProgress } from '../features/local/inference/types';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function LibraryPage() {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [selected, setSelected] = useState('');
  const [record, setRecord] = useState<PlaybackRecord | null>(null);
  const [viewMode, setViewMode] = useState<'tracks' | 'settings' | 'player'>('tracks');
  const [error, setError] = useState('');
  const spotify = useSpotifyOverlay();
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [active, setActive] = useState('');
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [backend, setBackend] = useState<'auto' | 'wasm'>('auto');
  const [modelCached, setModelCached] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [recording, setRecording] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const separator = useRef<LocalSeparator | null>(null);
  const running = useRef(false); const cancelled = useRef(false);
  const mix = useRef<PlaybackRecording | null>(null);
  const flush = useRef<(() => void) | null>(null);
  const playbackTracks = spotify.embedded
    ? spotify.tracks.flatMap(item => tracks.filter(track => track.id === `spotify-${item.trackId}`))
    : tracks.filter(track => track.source === 'spotify').slice().reverse();
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
    const warn = (event: BeforeUnloadEvent) => { if (running.current || mix.current) { event.preventDefault(); event.returnValue = ''; } };
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
    if (running.current) return;
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
          setActive(id); setProgress(null);
          try { await processLocalTrack(id, separator.current!, () => cancelled.current, setProgress); }
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
      if (running.current || disposed) return;
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
  const remove = async (id: string) => {
    try { await deleteTrack(id); if (selected === id) { setSelected(''); loadedRevision.current = ''; setRecord(null); } setConfirmDelete(''); await refresh(); }
    catch (reason) { setError(errorText(reason)); }
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
    }) : playbackTracks;
  const close = useCallback(() => { setViewMode('tracks'); spotify.close(); }, [spotify]);
  const canCapture = spotify.embedded && !spotify.starting && (spotify.active || (spotify.supported && spotify.tracks.length > 0));
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
    if (recording && selected !== id) return;
    if (selected !== id) { loadedRevision.current = ''; setRecord(null); setSelected(id); setAutoPlay(false); }
    setViewMode('player');
  };
  return <main className="iframe-page" aria-label="ktv420 iframe controls">
    <div className="iframe-actions">
      <button type="button" className="iframe-close-button" aria-label="Close" title="Close" onClick={close}>❌</button>
      <button type="button" className="iframe-logo-button" aria-label="Start or stop ktv420 capture"
        title={spotify.active ? 'Stop capture' : 'Start capture'} aria-disabled={!canCapture} disabled={!canCapture}
        aria-pressed={spotify.active} onClick={spotify.toggleCapture}><img alt="" src="./favicon.svg" /></button>
      <button type="button" className="iframe-settings-button" aria-label="Toggle settings view" title="Settings"
        aria-pressed={viewMode === 'settings'} onClick={() => setViewMode(viewMode === 'settings' ? 'tracks' : 'settings')}>⚙️</button>
    </div>
    {(error || spotify.error) && <p className="iframe-settings-error" role="alert">{error || spotify.error}</p>}
    {viewMode === 'settings' && <section className="iframe-settings-view" aria-label="Settings view">
      <section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Processing</h2><span>{modelCached ? 'Model cached' : 'Model: 181 MB'}</span></header>
        <div className="iframe-processing-controls">
          <label>Device <select value={backend} disabled={!!active} onChange={event => setBackend(event.target.value as 'auto' | 'wasm')}>
            <option value="auto">GPU preferred</option><option value="wasm">CPU compatibility</option>
          </select></label>
          <button onClick={() => setProcessingEnabled(!autoProcessing)}>{autoProcessing ? 'Pause separation' : 'Resume separation'}</button>
          {active && <progress max={1} value={progress?.fraction || 0} aria-label="Separation progress" title={progress?.message} />}
          <button disabled={!!active} onClick={() => void clearModelCache().then(refresh).catch(reason => setError(errorText(reason)))}>Clear model cache</button>
        </div>
      </section>
      <section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Local audio</h2><span>{size(tracks.reduce((total, track) => total + track.bytes, 0))}</span></header>
        <ol className="iframe-settings-list">{tracks.map(track => <li key={track.id}>
          <div className="iframe-settings-row"><span className="iframe-settings-kind">♫</span><span className="iframe-settings-path">{track.title}</span>
            <span className="iframe-settings-size">{size(track.bytes)}</span><span className="iframe-settings-row-actions">
              {track.status === 'error' && <button className="iframe-settings-emoji-button" disabled={!!active} title="Retry separation" aria-label={`Retry ${track.title}`} onClick={() => void processTracks([track.id])}>↻</button>}
              {confirmDelete === track.id ? <><button disabled={!!active || recording} onClick={() => void remove(track.id)}>Delete</button><button onClick={() => setConfirmDelete('')}>Cancel</button></> :
                <button className="iframe-settings-emoji-button" disabled={!!active || recording} title="Delete audio" aria-label={`Delete ${track.title}`} onClick={() => setConfirmDelete(track.id)}>🗑️</button>}
            </span></div>
        </li>)}</ol>
      </section>
    </section>}
    {viewMode === 'tracks' && <ol className="iframe-track-list" aria-label="Spotify page tracks">
      {displayTracks.map((track, index) => {
        const state = track.status === 'ready' ? 'complete' : track.status === 'error' ? 'broken' : track.status === 'missing' ? 'missing' : 'in-progress';
        const label = track.status === 'ready' ? 'Ready' : track.status === 'error' ? 'Failed' : track.status === 'missing' ? 'Not captured' : track.status === 'processing' ? 'Separating' : 'Queued';
        const artwork = typeof track.metadata?.trackArtworkSrc === 'string' ? track.metadata.trackArtworkSrc : '';
        return <li className="iframe-track-row" key={`${track.id}-${index}`} role="button" tabIndex={track.status !== 'missing' ? 0 : -1}
          aria-label={`${track.title} — ${label}`} aria-disabled={track.status === 'missing' || (recording && selected !== track.id)}
          title={track.error || (active === track.id ? progress?.message : label)}
          onClick={() => { if (track.status !== 'missing') openTrack(track.id); }}
          onKeyDown={event => { if (track.status !== 'missing' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); openTrack(track.id); } }}>
          <span className="iframe-track-state" data-state={state} aria-label={label} />
          {artwork && <img className="iframe-track-artwork" alt="" src={artwork} crossOrigin="anonymous" />}
          <span className="iframe-track-copy"><span className="iframe-track-name">{track.title}</span><span className="iframe-track-artist">{track.artist}</span></span>
        </li>;
      })}
    </ol>}
    {activeTrack && record && record.md5 === selected && <section className="iframe-player-view" hidden={viewMode !== 'player'} aria-label="Player">
      <button className="iframe-player-back" aria-label="Back to tracks" onClick={() => setViewMode('tracks')}>←</button>
      <Player record={record} title={activeTrack.title}
        hasPreviousTrack={!recording && selectedIndex > 0} hasNextTrack={!recording && selectedIndex >= 0 && selectedIndex < playbackTracks.length - 1}
        onPreviousTrack={() => navigateTrack(-1)} onNextTrack={() => navigateTrack(1)} onTrackEnd={() => navigateTrack(1)}
        autoPlayOnReady={autoPlay} onAutoPlayOnReadyHandled={() => setAutoPlay(false)} trackMetadata={activeTrack.metadata} isRecording={recording}
        onStartRecording={startRecording} onStopRecording={stopRecording} onRecordingEvent={recordEvent} onRegisterRecordingFlush={callback => { flush.current = callback; }} />
      <details className="iframe-player-exports"><summary>Export audio</summary>{record.files.map(file => <button key={file.path}
        onClick={() => downloadBlob(file.blob, `${activeTrack.title}-${file.name}`)}>{file.name.replace(/\.(wav|mp3)$/i, '')}</button>)}</details>
    </section>}
  </main>;
}

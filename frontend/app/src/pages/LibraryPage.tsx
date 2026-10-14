import { useCallback, useEffect, useRef, useState } from 'react';
import Player from '../features/stems/player/Player';
import type { PlaybackRecord, PlaybackRecording, RecordingEvent, RecordingStartRequest } from '../features/stems/player/types';
import { deleteTrack, getPlaybackRecord, listTracks, type LocalTrack } from '../features/local/library';
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
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const spotify = useSpotifyOverlay();
  const [autoProcessing, setAutoProcessing] = useState(() => localStorage.getItem('ktv420-auto-processing') !== 'paused');
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
  const refresh = useCallback(async () => { setTracks(await listTracks()); setModelCached(await getModelCacheStatus()); }, []);
  useEffect(() => {
    const update = () => { void refresh().catch(reason => setError(errorText(reason))); };
    update(); const timer = setInterval(update, 2500);
    void navigator.storage.persist?.();
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
      await navigator.locks.request('ktv420-separation', { ifAvailable: true }, async lock => {
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
          cancelled: () => cancelled.current || localStorage.getItem('ktv420-auto-processing') === 'paused',
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
  useEffect(() => {
    const sync = () => {
      const enabled = localStorage.getItem('ktv420-auto-processing') !== 'paused';
      setAutoProcessing(enabled);
      if (!enabled) { cancelled.current = true; separator.current?.dispose(); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setProcessingEnabled = (enabled: boolean) => {
    localStorage.setItem('ktv420-auto-processing', enabled ? 'enabled' : 'paused'); setAutoProcessing(enabled);
    if (!enabled) { cancelled.current = true; separator.current?.dispose(); }
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
      status: 'missing', source: 'spotify', bytes: 0, frames: 0, sampleRate: 44100,
    }) : playbackTracks;
  const visible = displayTracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="local-app">
    <header className="library-header"><div><p className="eyebrow">ALL LOCAL · FOUR STEMS · YOUR MIX</p><h1>ktv420<span className="accent">.</span></h1><p>Capture Spotify as it plays. Listen and remix right here.</p></div>
      <div><a href="https://ktv420.web.app" target="_blank" rel="noreferrer">Getting started ↗</a>{spotify.embedded && <button onClick={spotify.close} style={{ marginLeft: 16 }}>Back to Spotify</button>}</div></header>
    <section className="library-tools" aria-label="Spotify capture controls">
      {spotify.embedded ? <button className="primary" disabled={spotify.starting || (!spotify.active && (!spotify.supported || !spotify.tracks.length))}
        onClick={spotify.toggleCapture}>{spotify.starting ? 'Starting…' : spotify.active ? 'Stop capture' : 'Capture tracks'}</button>
        : <a href="https://open.spotify.com/">Open Spotify to capture a playlist or album ↗</a>}
      <label>Processing <select value={backend} disabled={!!active} onChange={event => setBackend(event.target.value as 'auto' | 'wasm')}><option value="auto">GPU preferred</option><option value="wasm">CPU compatibility</option></select></label>
      <button onClick={() => setProcessingEnabled(!autoProcessing)}>{autoProcessing ? 'Pause separation' : 'Resume separation'}</button><span className="muted">{autoProcessing ? 'Captured songs separate automatically' : 'Separation paused; captures stay queued'}</span>
    </section>
    <div className="local-facts"><span>{playbackTracks.length} captured tracks · {size(playbackTracks.reduce((total,track) => total+track.bytes,0))}</span><span>{modelCached ? 'Model saved for offline use' : 'First separation downloads a 181 MB model'}</span><span>Audio never uploaded</span></div>
    {spotify.embedded && <p className="muted">{spotify.active ? 'Capturing Spotify in real time. Do not seek or change tracks.' : spotify.supported ? 'Capture plays this playlist or album in order and skips songs already captured.' : 'Open a Spotify playlist or album to begin.'}</p>}
    {spotify.notice && <p role="status">{spotify.notice}</p>}
    {spotify.error && <div className="notice error" role="alert">{spotify.error}</div>}
    {error && <div className="notice error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {active && <section className="notice processing" role="status"><strong>{tracks.find(track => track.id === active)?.title}</strong><span>{progress?.message || 'Preparing local audio…'}</span><progress max={1} value={progress?.fraction || 0} aria-label="Separation progress" /><button onClick={() => setProcessingEnabled(false)}>Pause separation</button><small>Keep Spotify open. You can hide this overlay while processing continues.</small></section>}
    <div className="library-layout"><section className="track-library" aria-label="Tracks"><label className="search-label">Spotify tracks<input type="search" placeholder="Search tracks or artists" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {!displayTracks.length && <div className="empty-library"><h2>Start on Spotify.</h2><p>Open a playlist or album, click ktv420 and choose Capture tracks. Stems appear here automatically as each song finishes.</p><p>Float32 audio uses about 424 MB for a four-minute original plus four stems.</p></div>}
      {visible.map(track => <article className={`library-track ${selected === track.id ? 'selected' : ''}`} key={track.id}>
        <button className="track-select" disabled={track.status === 'missing' || (recording && selected !== track.id)} onClick={() => { if (selected !== track.id) { loadedRevision.current = ''; setRecord(null); setSelected(track.id); setAutoPlay(false); } }}><strong>{track.title}</strong><span>{track.artist || (track.source === 'spotify' ? 'Spotify capture' : 'Local file')}</span></button>
        <div className="track-facts"><span className={`status ${track.status}`}>{track.status === 'missing' ? 'Not captured' : track.status === 'captured' ? 'Queued for separation' : track.status === 'processing' && active !== track.id ? 'Processing / awaiting resume' : track.status}</span>{track.status !== 'missing' && <span>{Math.floor(track.frames/track.sampleRate/60)}:{String(Math.floor(track.frames/track.sampleRate)%60).padStart(2,'0')} · {size(track.bytes)}</span>}</div>
        {track.error && <p className="track-error">{track.error}</p>}
        <div className="track-actions">{track.status === 'error' && <button disabled={!!active} onClick={() => void processTracks([track.id])}>Retry separation</button>}
          {track.status !== 'missing' && (confirmDelete === track.id ? <><span>Delete local audio?</span><button disabled={!!active || recording} onClick={() => void remove(track.id)}>Delete</button><button onClick={() => setConfirmDelete('')}>Keep</button></> : <button disabled={!!active || recording} onClick={() => setConfirmDelete(track.id)}>Remove</button>)}</div>
      </article>)}
      {displayTracks.length > 0 && !visible.length && <p>No matching tracks.</p>}
      <details className="storage-details"><summary>Local storage</summary><p>Stored in this Chrome profile. Uninstalling the extension removes its library. Export files you want to keep.</p><button disabled={!!active} onClick={() => void clearModelCache().then(refresh).catch(reason => setError(errorText(reason)))}>Remove downloaded model</button></details>
    </section><section className="listening-room" aria-label="Player">
      {activeTrack && record && record.md5 === selected ? <><div className="now-playing"><p className="eyebrow">{activeTrack.status === 'ready' ? 'READY TO REMIX' : 'ORIGINAL AUDIO'}</p><h2>{activeTrack.title}</h2><p>{activeTrack.artist}</p></div>
        <Player record={record} title={activeTrack.title}
          hasPreviousTrack={!recording && selectedIndex > 0} hasNextTrack={!recording && selectedIndex >= 0 && selectedIndex < playbackTracks.length - 1}
          onPreviousTrack={() => navigateTrack(-1)} onNextTrack={() => navigateTrack(1)} onTrackEnd={() => navigateTrack(1)}
          autoPlayOnReady={autoPlay} onAutoPlayOnReadyHandled={() => setAutoPlay(false)} trackMetadata={activeTrack.metadata} isRecording={recording} onStartRecording={startRecording} onStopRecording={stopRecording} onRecordingEvent={recordEvent} onRegisterRecordingFlush={callback => { flush.current = callback; }} />
        <div className="exports"><strong>Export WAV</strong>{record.files.map(file => <button key={file.path} onClick={() => downloadBlob(file.blob, `${activeTrack.title}-${file.name}`)}>{file.name.replace('.wav','')}</button>)}
          {activeTrack.metadata?.decodedAt44100 === true && <button onClick={() => void getPlaybackRecord(selected).then(all => {const original=all.files.find(file => file.name==='source'); if(original) downloadBlob(original.blob,String(activeTrack.metadata?.originalName || 'source'));})}>Original source file</button>}</div>
        {recording && <p className="muted">Recording mixer actions locally. Stop recording to export the action log as JSON.</p>}
      </> : <div className="player-empty"><div className="stem-bars" aria-hidden="true"><i/><i/><i/><i/></div><h2>Four stems.<br/>Endless combinations.</h2><p>Select a track to listen, adjust its stems and explore the visualizers.</p></div>}
    </section></div>
  </main>;
}

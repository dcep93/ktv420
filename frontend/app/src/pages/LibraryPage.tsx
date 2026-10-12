import { useCallback, useEffect, useRef, useState } from 'react';
import Player from '../features/stems/player/Player';
import type { PlaybackRecord, PlaybackRecording, RecordingEvent, RecordingStartRequest } from '../features/stems/player/types';
import { deleteTrack, getPlaybackRecord, listTracks, setTrackStatus, type LocalTrack } from '../features/local/library';
import { importAudio, downloadBlob } from '../features/local/importAudio';
import { processLocalTrack } from '../features/local/processing';
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
  const [importing, setImporting] = useState(false);
  const [active, setActive] = useState('');
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [backend, setBackend] = useState<'auto' | 'wasm'>('auto');
  const [modelCached, setModelCached] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [recording, setRecording] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const separator = useRef<LocalSeparator | null>(null);
  const importingRef = useRef(false);
  const running = useRef(false); const cancelled = useRef(false);
  const mix = useRef<PlaybackRecording | null>(null);
  const flush = useRef<(() => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selectedIndex = tracks.findIndex(track => track.id === selected);
  const activeTrack = tracks[selectedIndex];
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
  const loadedRevision = useRef('');
  useEffect(() => {
    let disposed = false;
    const revision = `${selected}/${selectedReady ? 'stems' : 'input'}`;
    if (recording || loadedRevision.current === revision) return;
    if (selected) void getPlaybackRecord(selected).then(next => {
      if (!disposed) { loadedRevision.current = revision; setRecord({ ...next, files: next.files.filter(file => file.name !== 'source') }); }
    }).catch(reason => { if (!disposed) setError(errorText(reason)); });
    return () => { disposed = true; };
  }, [selected, selectedReady, recording]);
  const acceptFiles = async (files: File[]) => {
    if (importing || recording) return;
    importingRef.current = true; setImporting(true); setError('');
    try { for (const file of files) { const id = await importAudio(file); if (!mix.current) setSelected(id); await refresh(); } }
    catch (reason) { setError(`Import failed: ${errorText(reason)}`); }
    finally { importingRef.current = false; setImporting(false); if (input.current) input.current.value = ''; }
  };
  const processTracks = async (ids: string[]) => {
    if (running.current) return;
    running.current = true; cancelled.current = false; setError('');
    try {
      await navigator.locks.request('ktv420-separation', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another ktv420 tab is processing. Return to that tab or wait for it to finish.');
        for (const track of await listTracks()) if (track.status === 'processing') await setTrackStatus(track.id, 'captured');
        separator.current = new LocalSeparator(backend === 'wasm' ? { backend: 'wasm' } : {});
        for (const id of ids) {
          if (cancelled.current) break;
          setActive(id); setProgress(null);
          try {
            await processLocalTrack(id, separator.current, () => cancelled.current, setProgress);
          } catch (reason) {
            setError(errorText(reason)); break;
          } finally { await refresh(); }
        }
      });
    } catch (reason) { setError(errorText(reason)); }
    finally { separator.current?.dispose(); separator.current = null; running.current = false; setActive(''); setProgress(null); await refresh(); }
  };
  const remove = async (id: string) => {
    try { await deleteTrack(id); if (selected === id) { setSelected(''); loadedRevision.current = ''; setRecord(null); } setConfirmDelete(''); await refresh(); }
    catch (reason) { setError(errorText(reason)); }
  };
  const recordEvent = useCallback((event: RecordingEvent) => { mix.current?.events.push(event); }, []);
  const startRecording = useCallback(async (request: RecordingStartRequest) => {
    if (importingRef.current) return false;
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
    const next = tracks[selectedIndex + offset];
    if (!next || recording) return;
    loadedRevision.current = ''; setRecord(null); setSelected(next.id); setAutoPlay(true);
  };
  const visible = tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="local-app" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void acceptFiles([...event.dataTransfer.files]); }}>
    <header className="library-header"><div><p className="eyebrow">ALL LOCAL · FOUR STEMS · YOUR MIX</p><h1>ktv420<span className="accent">.</span></h1><p>Pull apart a track. Find a different way to hear it.</p></div>
      <a href="https://ktv420.web.app" target="_blank" rel="noreferrer">Getting started ↗</a></header>
    <section className="library-tools" aria-label="Library controls">
      <div><button className="primary" disabled={importing || recording} onClick={() => input.current?.click()}>{importing ? 'Importing…' : '+ Add audio'}</button>
        <input ref={input} className="visually-hidden" type="file" multiple accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg" aria-label="Import audio files" onChange={event => void acceptFiles([...event.target.files || []])} />
        <span className="muted"> or drop files anywhere</span></div>
      <label>Processing <select value={backend} disabled={!!active} onChange={event => setBackend(event.target.value as 'auto' | 'wasm')}><option value="auto">GPU preferred</option><option value="wasm">CPU compatibility</option></select></label>
      <button disabled={!!active || !tracks.some(track => track.status !== 'ready')} onClick={() => void processTracks(tracks.filter(track => track.status !== 'ready').map(track => track.id))}>Separate pending</button>
    </section>
    <div className="local-facts"><span>{tracks.length} tracks · {size(tracks.reduce((total,track) => total+track.bytes,0))}</span><span>{modelCached ? 'Model saved for offline use' : 'First separation downloads a 181 MB model'}</span><span>Audio never uploaded</span></div>
    {error && <div className="notice error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {active && <section className="notice processing" role="status"><strong>{tracks.find(track => track.id === active)?.title}</strong><span>{progress?.message || 'Preparing local audio…'}</span><progress max={1} value={progress?.fraction || 0} aria-label="Separation progress" /><button onClick={() => { cancelled.current = true; separator.current?.dispose(); }}>Cancel</button><small>Keep this tab open. You can listen while processing continues.</small></section>}
    <div className="library-layout"><section className="track-library" aria-label="Tracks"><label className="search-label">Your library<input type="search" placeholder="Search tracks or artists" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {!tracks.length && <div className="empty-library"><h2>Start with a track.</h2><p>Add a local audio file, or capture a playlist using the ktv420 controls on Spotify.</p><p>WAV samples retain their original precision. Compressed imports decode at 44.1 kHz; their source files are also kept.</p><p>Float32 audio uses about 424 MB for a four-minute original plus four stems.</p></div>}
      {visible.map(track => <article className={`library-track ${selected === track.id ? 'selected' : ''}`} key={track.id}>
        <button className="track-select" disabled={recording && selected !== track.id} onClick={() => { if (selected !== track.id) { loadedRevision.current = ''; setRecord(null); setSelected(track.id); setAutoPlay(false); } }}><strong>{track.title}</strong><span>{track.artist || (track.source === 'spotify' ? 'Spotify capture' : 'Local file')}</span></button>
        <div className="track-facts"><span className={`status ${track.status}`}>{track.status === 'captured' ? 'Ready to separate' : track.status === 'processing' && active !== track.id ? 'Interrupted / other tab' : track.status}</span><span>{Math.floor(track.frames/track.sampleRate/60)}:{String(Math.floor(track.frames/track.sampleRate)%60).padStart(2,'0')} · {size(track.bytes)}</span></div>
        {track.error && <p className="track-error">{track.error}</p>}
        <div className="track-actions">{track.status !== 'ready' && <button disabled={!!active} onClick={() => void processTracks([track.id])}>{track.status === 'error' ? 'Retry separation' : 'Separate'}</button>}
          {confirmDelete === track.id ? <><span>Delete local audio?</span><button disabled={!!active || recording} onClick={() => void remove(track.id)}>Delete</button><button onClick={() => setConfirmDelete('')}>Keep</button></> : <button disabled={!!active || recording} onClick={() => setConfirmDelete(track.id)}>Remove</button>}</div>
      </article>)}
      {tracks.length > 0 && !visible.length && <p>No matching tracks.</p>}
      <details className="storage-details"><summary>Local storage</summary><p>Stored in this Chrome profile. Uninstalling the extension removes its library. Export files you want to keep.</p><button disabled={!!active} onClick={() => void clearModelCache().then(refresh).catch(reason => setError(errorText(reason)))}>Remove downloaded model</button></details>
    </section><section className="listening-room" aria-label="Player">
      {activeTrack && record && record.md5 === selected ? <><div className="now-playing"><p className="eyebrow">{activeTrack.status === 'ready' ? 'READY TO REMIX' : 'ORIGINAL AUDIO'}</p><h2>{activeTrack.title}</h2><p>{activeTrack.artist}</p></div>
        <Player record={record} title={activeTrack.title}
          hasPreviousTrack={!recording && selectedIndex > 0} hasNextTrack={!recording && selectedIndex < tracks.length - 1}
          onPreviousTrack={() => navigateTrack(-1)} onNextTrack={() => navigateTrack(1)} onTrackEnd={() => navigateTrack(1)}
          autoPlayOnReady={autoPlay} onAutoPlayOnReadyHandled={() => setAutoPlay(false)} trackMetadata={activeTrack.metadata} isRecording={recording} onStartRecording={startRecording} onStopRecording={stopRecording} onRecordingEvent={recordEvent} onRegisterRecordingFlush={callback => { flush.current = callback; }} />
        <div className="exports"><strong>Export WAV</strong>{record.files.map(file => <button key={file.path} onClick={() => downloadBlob(file.blob, `${activeTrack.title}-${file.name}`)}>{file.name.replace('.wav','')}</button>)}
          {activeTrack.metadata?.decodedAt44100 === true && <button onClick={() => void getPlaybackRecord(selected).then(all => {const original=all.files.find(file => file.name==='source'); if(original) downloadBlob(original.blob,String(activeTrack.metadata?.originalName || 'source'));})}>Original source file</button>}</div>
        {recording && <p className="muted">Recording mixer actions locally. Stop recording to export the action log as JSON.</p>}
      </> : <div className="player-empty"><div className="stem-bars" aria-hidden="true"><i/><i/><i/><i/></div><h2>Four stems.<br/>Endless combinations.</h2><p>Select a track to listen, adjust its stems and explore the visualizers.</p></div>}
    </section></div>
  </main>;
}

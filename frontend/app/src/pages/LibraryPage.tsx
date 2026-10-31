import { collectionLink } from '../features/local/savedCollections';
import { separationStatus, separationProgressLabel } from '../features/local/separationStatus';
import { libraryChanges } from '../features/local/libraryChanges';
import { missingTrackLabel } from '../features/local/missingTrackLabel';
import { useSpacePlayback } from '../features/local/useSpacePlayback';
import { usePlayerPreferences } from '../features/local/usePlayerPreferences';
import { useHostedCapture } from '../features/local/useHostedCapture';
import { capturedPlaylistStart } from '../features/local/playlistLogo';
import { catalogUrl } from '../features/local/extensionConnection';
import { useReplayExport } from '../features/local/export/useReplayExport';
import ReplayExportButton from './ReplayExportButton';
import { loadPerformance, savePerformance } from '../features/local/performanceFiles';
import { PerformanceClock, parseRecording, MAX_RECORDING_BYTES, validSnapshot, type PerformanceRecording, type MixerControl } from '../features/local/recording';
import { useReplay } from '../features/local/useReplay';
import { captureStartSeconds } from '../features/local/captureAlignment';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Player from '../features/stems/player/Player';
import PlayerViewport from './PlayerViewport';
import OverlayIcon from './OverlayIcon';
import type { PlaybackRecord, RecordingEvent, RecordingStartRequest } from '../features/stems/player/types';
import { deleteTrack, getPlaybackRecord, listTracks, getProcessingEnabled, setProcessingEnabled as saveProcessingEnabled, withProcessingLock, type LocalTrack } from '../features/local/libraryClient';
import { downloadBlob } from '../features/local/importAudio';
import { processLocalTrack } from '../features/local/processing';
import { drainSpotifyQueue } from '../features/local/spotifyQueue';
import { nextSeparationFraction } from '../features/local/rowProgress';
import { usePlaylist } from '../features/local/usePlaylist';
import { withSpotifyMetadata } from '../features/local/trackMetadata';
import { LocalSeparator } from '../features/local/inference/client';
import { clearModelCache, getModelCacheStatus, loadModelBytes } from '../features/local/inference/model';
import type { SeparationProgress } from '../features/local/inference/types';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function LibraryPage() {
  const mp3Export = useReplayExport();
  const exportController = mp3Export.controller;
  const [storedTracks, setTracks] = useState<LocalTrack[]>([]);
  const [libraryReady,setLibraryReady] = useState(false);
  const [selected, setSelected] = useState('');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [record, setRecord] = useState<PlaybackRecord | null>(null);
  const [viewMode, setViewMode] = useState<'tracks' | 'settings' | 'player'>('tracks');
  const page = useRef<HTMLElement>(null);
  const viewScroll = useRef({ tracks: 0, settings: 0, player: 0 });
  const [error, setError] = useState('');
  const closeRef = useRef<() => void>(() => {});
  const spotify = usePlaylist(() => closeRef.current());
  const scrollContext = useRef('');
  useLayoutEffect(() => {
    if (scrollContext.current !== spotify.spotifyPath) {
      scrollContext.current = spotify.spotifyPath;
      viewScroll.current.tracks = 0;
    }
    if (page.current) page.current.scrollTop = viewScroll.current[viewMode];
  }, [viewMode, spotify.spotifyPath]);
  const tracks = useMemo(() => {
    const rows = new Map(spotify.tracks.map(row => [`spotify-${row.trackId}`, row]));
    return storedTracks.map(track => withSpotifyMetadata(track, rows.get(track.id)));
  }, [storedTracks, spotify.tracks]);
  const [masterVolume, setMasterVolume] = useState(1);
  const remoteVolume = spotify.captureVolume;
  useEffect(() => {
    if (remoteVolume != null) setMasterVolume(remoteVolume);
  }, [remoteVolume]);
  const transportCommand = spotify.transport;
  const entryRevision = useRef(-1), appliedNavigation = useRef(-1);
  const setUrlView = spotify.setView, urlNavigation = spotify.navigation, spotifyRows = spotify.tracks;
  const syncTrackUrl = useCallback((id: string, replace = false, rowIndex?: number) => {
    const row = spotifyRows.find(item => `spotify-${item.trackId}` === id && (rowIndex === undefined || item.rowIndex === rowIndex));
    if (row && urlNavigation) setUrlView(row.rowIndex + 1, urlNavigation.revision, replace);
  }, [spotifyRows, urlNavigation, setUrlView]);
  const [localProcessing, setAutoProcessing] = useState(false);
  const autoProcessing = spotify.queueEnabled ?? localProcessing;
  const [active, setActive] = useState('');
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [separationFraction, setSeparationFraction] = useState<number | null>(null);
  const [localBackend, setBackend] = useState<'auto' | 'wasm'>('auto');
  const backend = spotify.queueBackend ?? localBackend;
  const queueBusy = spotify.librarySummary.some(row => row.location !== 'website' && row.status === 'processing');
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
  const mix = useRef<PerformanceRecording | null>(null);
  const recordingClock = useRef(new PerformanceClock());
  const mixer = useRef<MixerControl | null>(null);
  const {mixerSettings,rememberMixerSettings,combinedVisualizerExpanded,setCombinedVisualizerExpanded} =
    usePlayerPreferences(!spotify.replay && !mp3Export.busy);
  const [savedMix,setSavedMix] = useState<PerformanceRecording | null>(null);
  const replay = useReplay({recording:spotify.replay,
    select:id => { if(selected!==`spotify-${id}`) { loadedRevision.current='';setSelected(`spotify-${id}`);setRecord(null); } setSelectedRowIndex(null); syncTrackUrl(`spotify-${id}`, true); setViewMode('player'); },
    control:() => mixer.current,offset:id => captureStartSeconds(tracks.find(t => t.id===`spotify-${id}`)?.metadata),
  });
  const required = spotify.replay?.tracks || [];
  const capture = useHostedCapture({spotify,tracks,libraryReady,required,replaying:replay.active,onError:setError});
  const replayReady = required.length>0 && required.every(item => tracks.some(t => t.id===`spotify-${item.id}` && t.status==='ready' && Math.abs(t.frames/t.sampleRate+captureStartSeconds(t.metadata)-item.duration)<1));
  useEffect(() => { if (spotify.replay) setViewMode('tracks'); }, [spotify.replay]);
  useEffect(() => {
    void Promise.all([loadPerformance('last'),loadPerformance('draft')]).then(([last,draft]) => { setSavedMix(draft || last);if(draft) setError('Recovered a partial recording. Download its JSON before starting another.'); }).catch(() => {});
  }, []);
  const flush = useRef<(() => void) | null>(null);
  useEffect(() => {
    if(!recording) return;
    const timer=setInterval(() => {
      const current=mix.current,last=current?.events.at(-1);
      if(!current || !last) return;
      const draft={...current,events:[...current.events,{...last,type:'stop' as const}]};
      void savePerformance('draft',draft).catch(() => {});
    },2000);
    return () => clearInterval(timer);
  },[recording]);
  const savedSpotifyTracks = spotify.tracks.flatMap(item => tracks.filter(track => track.id === `spotify-${item.trackId}`).map(track => ({ ...track, rowIndex: item.rowIndex })));
  const playbackTracks = savedSpotifyTracks.filter(track => track.status === 'ready');
  const selectedIndex = playbackTracks.findIndex(track => track.id === selected && (selectedRowIndex === null || track.rowIndex === selectedRowIndex));
  const activeTrack = tracks.find(track => track.id === selected);
  const captureOffset = captureStartSeconds(activeTrack?.metadata);
  const observedProcessingPreference = useRef<boolean | null>(null);
  const acknowledgeSaved = spotify.acknowledgeSaved;
  const refreshRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    const [savedTracks, enabled] = await Promise.all([listTracks(), getProcessingEnabled()]);
    if (revision !== refreshRevision.current) return;
    setTracks(savedTracks); setLibraryReady(true); setAutoProcessing(enabled);
    void getModelCacheStatus().then(cached => { if (revision === refreshRevision.current) setModelCached(cached); });
    acknowledgeSaved(savedTracks.map(track => track.id.replace(/^spotify-/, '')));
    if (observedProcessingPreference.current === true && !enabled) { cancelled.current = true; separator.current?.dispose(); }
    observedProcessingPreference.current = enabled;
  }, [acknowledgeSaved]);
  useEffect(() => { void refresh().catch(reason => setError(errorText(reason))); },
    [spotify.captureProgress?.trackId, spotify.captureProgress?.phase, refresh]);
  useEffect(() => {
    const update = () => { void refresh().catch(reason => setError(errorText(reason))); };
    update(); const timer = setInterval(update, 2500);
    libraryChanges.addEventListener('change', update);
    return () => { clearInterval(timer); libraryChanges.removeEventListener('change', update); };
  }, [refresh]);
  useEffect(() => () => { cancelled.current = true; separator.current?.dispose(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (running.current || deleting.current || modelBusy.current || exportController.current || mix.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [exportController]);
  const selectedReady = activeTrack?.status === 'ready';
  const selectedCreatedAt = activeTrack?.createdAt;
  const loadedRevision = useRef('');
  useEffect(() => {
    let disposed = false;
    const revision = `${selected}/${selectedRowIndex}/${selectedCreatedAt}/${selectedReady ? 'stems' : 'input'}`;
    if (loadedRevision.current === revision) return;
    if (selected) void getPlaybackRecord(selected).then(next => {
      if (!disposed) { loadedRevision.current = revision; setRecord({ ...next, files: next.files.filter(file => file.name !== 'source') }); }
    }).catch(reason => { if (!disposed) { setError(errorText(reason)); } });
    return () => { disposed = true; };
  }, [selected, selectedRowIndex, selectedReady, selectedCreatedAt, recording, transportCommand]);
  const processTracks = useCallback(async (ids: string[], automatic = false) => {
    if (running.current || deleting.current || modelBusy.current || exportController.current) return;
    running.current = true; cancelled.current = false; setError('');
    try {
      await withProcessingLock(async lock => {
        if (!lock) {
          if (!automatic) setError('Another ktv420 view is processing these captures.');
          return;
        }
        separator.current = new LocalSeparator({ backend: backend === 'wasm' ? 'wasm' : undefined });
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
  }, [backend, refresh, exportController]);
  const setProcessingEnabled = (enabled: boolean) => {
    if (!enabled) { cancelled.current = true; separator.current?.dispose(); }
    void (spotify.queueEnabled === null ? saveProcessingEnabled(enabled) : spotify.configureQueue(enabled, enabled).then(() => saveProcessingEnabled(enabled))).then(() => { observedProcessingPreference.current = enabled; setAutoProcessing(enabled); }).catch(reason => setError(errorText(reason)));
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
    if (running.current || deleting.current || recording || capture.active || spotify.starting) return;
    deleting.current = true; setDeletingAudio(true); setError('');
    try {
      // Delete website audio only; previous extension databases remain untouched.
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
  const saveMix = useCallback((download = true) => {
    if (!mix.current) return;
    const value = parseRecording(mix.current);
    void savePerformance('last',value).then(() => savePerformance('draft',null)).catch(() => setError('Recording downloaded, but could not keep a local backup.'));
    setSavedMix(value);
    if(download) downloadBlob(new Blob([JSON.stringify(value)],{type:'application/json'}),`${value.name}.json`);
    mix.current=null;recordingClock.current.pause();setRecording(false);
  }, []);
  const recordEvent = useCallback((event: RecordingEvent) => {
    const current=mix.current, control=mixer.current;
    if(!current || !control?.ready) return;
    const id=control.trackId.replace(/^spotify-/,'');
    if(current.events.at(-1)?.trackId!==id) return;
    const kind = event.type==='mixer_snapshot' ? 'mix' : event.type==='transport_play' ? 'play' : event.type==='transport_pause' ? 'pause' : event.type==='seek_commit' ? 'seek' : null;
    if(!kind) return;
    const offset=captureStartSeconds(tracks.find(t => t.id===control.trackId)?.metadata);
    const position=event.trackTimeSeconds+offset;
    const previous=current.events.at(-1);
    if(kind==='mix' && JSON.stringify(previous?.snapshot)===JSON.stringify(event.payload?.snapshot)) return;
    current.events.push({type:kind,at:recordingClock.current.seconds,trackId:id,position,
      ...(kind==='mix' && validSnapshot(event.payload?.snapshot) ? {snapshot:event.payload.snapshot} : {})});
    if(current.events.length>=29000 || (current.events.length%50===0 && JSON.stringify(current).length>MAX_RECORDING_BYTES-20000)) {
      current.events.push({type:'stop',at:recordingClock.current.seconds,trackId:id,position});
      control.pause();saveMix();setError('Recording saved at the file-size limit. Start another recording to continue.');
    }
  }, [tracks,saveMix]);
  const onControls = useCallback((control: MixerControl | null) => {
    mixer.current=control;
    const current=mix.current;
    if(!control?.ready || !current) return;
    const id=control.trackId.replace(/^spotify-/,'');
    if(current.events.at(-1)?.trackId===id) return;
    const track=tracks.find(t => t.id===control.trackId);
    if(!track) return;
    const position=control.position()+captureStartSeconds(track.metadata);
    if(!current.tracks.some(t => t.id===id)) current.tracks.push({id,title:track.title,duration:track.frames/track.sampleRate+captureStartSeconds(track.metadata)});
    current.events.push({type:'track',at:recordingClock.current.seconds,trackId:id,position,snapshot:control.snapshot()});
  }, [tracks]);
  const startRecording = useCallback(async (request: RecordingStartRequest) => {
    if(exportController.current) return false;
    if(!spotify.spotifyPath || !activeTrack) {setError(spotify.supported ? 'Select a prepared track before recording.' : 'Open a playlist before recording.');return false;}
    const id=selected.replace(/^spotify-/,'');
    const position=request.trackTimeSeconds+captureOffset;
    mix.current={version:3,name:`ktv420-mix-${new Date().toISOString().replaceAll(':','-')}`,createdAt:new Date().toISOString(),spotifyPath:spotify.spotifyPath,
      tracks:[{id,title:activeTrack.title,duration:activeTrack.frames/activeTrack.sampleRate+captureOffset}],
      events:[{type:'track',at:0,trackId:id,position,snapshot:request.snapshot}]};
    recordingClock.current.reset();recordingClock.current.start();setRecording(true);setError('');return true;
  }, [selected,spotify.spotifyPath,spotify.supported,activeTrack,captureOffset,exportController]);
  const stopRecording = useCallback(async (event: RecordingEvent) => {
    const current=mix.current;if(!current) return;
    const previous=current.events.at(-1)!;
    current.events.push({type:'stop',at:recordingClock.current.seconds,trackId:previous.trackId,position:event.trackTimeSeconds+captureOffset});
    try { saveMix(); } catch(reason) { setError(errorText(reason)); }
  }, [captureOffset,saveMix]);
  const pauseForEntry = useCallback(() => {

    mixer.current?.pause(); setAutoPlay(false);
  }, []);
  useEffect(() => {
    const navigation = spotify.navigation;
    if (!navigation || spotify.replay || appliedNavigation.current === navigation.revision) return;
    if (entryRevision.current !== navigation.revision) {
      entryRevision.current = navigation.revision;
      if (mix.current) void stopRecording({ type: 'record_stop', trackTimeSeconds: mixer.current?.position() || 0 });
      pauseForEntry(); setViewMode('tracks');
    }
    if (!navigation.open || navigation.trackIndex === null) {
      appliedNavigation.current = navigation.revision; return;
    }
    const row = spotify.tracks.find(track => track.rowIndex + 1 === navigation.trackIndex);
    const id = row && `spotify-${row.trackId}`;
    if (capture.active || spotify.starting || !id || !tracks.some(track => track.id === id && (!spotify.standalone || track.status === 'ready'))) return;
    appliedNavigation.current = navigation.revision;
    pauseForEntry();
    if (selected !== id || selectedRowIndex !== row.rowIndex) { loadedRevision.current = ''; setRecord(null); setSelected(id); setSelectedRowIndex(row.rowIndex); viewScroll.current.player = 0; }
    setViewMode('player');
  }, [spotify.navigation, spotify.tracks, spotify.replay, capture.active, spotify.starting, tracks, selected, selectedRowIndex, pauseForEntry, stopRecording, spotify.standalone]);
  const onPlaybackError = useCallback((message: string) => {
    setError(message);
  }, []);
  const navigateTrack = (offset: number) => {
    const next = playbackTracks[selectedIndex + offset];
    if (!next || recording) return;

    loadedRevision.current = ''; setRecord(null); setSelected(next.id); setSelectedRowIndex(next.rowIndex); setAutoPlay(true); syncTrackUrl(next.id, true, next.rowIndex);
  };
  const allDisplayTracks: (Omit<LocalTrack, 'status'> & { status: LocalTrack['status'] | 'missing' })[] = spotify.tracks.map(item => tracks.find(track => track.id === `spotify-${item.trackId}`) || {
      id: `spotify-${item.trackId}`, title: item.trackName, artist: item.trackArtist, createdAt: 0,
      status: 'missing', source: 'spotify', bytes: 0, frames: 0, sampleRate: 44100, metadata: { trackArtworkSrc: item.trackArtworkSrc },
    });
  const displayTracks = spotify.replay ? required.map(item => allDisplayTracks.find(t => `spotify-${item.id}`===t.id) || tracks.find(t => `spotify-${item.id}`===t.id) || {id:`spotify-${item.id}`,title:item.title,artist:'',createdAt:0,status:'missing' as const,source:'spotify' as const,bytes:0,frames:0,sampleRate:44100,metadata:undefined,error:undefined}) : allDisplayTracks;
  // Cancel replay's pending async actions before hiding/unmounting its player.
  closeRef.current = () => {
    mp3Export.cancel(); replay.stop();
    if (mix.current) void stopRecording({type:'record_stop',trackTimeSeconds:mixer.current?.position() || 0});
    mixer.current?.pause(); setAutoPlay(false); setViewMode('tracks');
  };
  const close = useCallback(() => {
    const fromPlayer = viewMode === 'player' || viewMode === 'settings' && previousView.current === 'player';
    closeRef.current();
    if (fromPlayer) {
      previousView.current = 'tracks';
      if (urlNavigation) setUrlView(null, urlNavigation.revision, false);
    } else spotify.close();
  }, [spotify, viewMode, urlNavigation, setUrlView]);
  const canCapture = !mp3Export.busy && !replay.active && !recording && !spotify.standalone && !spotify.starting && !deletingAudio && (capture.active || (libraryReady && spotify.supported && spotify.tracksComplete && spotify.tracks.length > 0));
  const audioBusy = mp3Export.busy || replay.active || !!active || recording || capture.active || spotify.starting || deletingAudio;
  const firstCapturedTrack = viewMode === 'tracks' && spotify.tracksComplete && !spotify.replay && !capture.active
    ? spotify.standalone ? spotify.tracks.find(row => tracks.some(track => track.id === `spotify-${row.trackId}` && track.status === 'ready')) ?? null
      : capturedPlaylistStart(spotify.tracks, tracks, libraryReady) : null;
  const canUseLogo = canCapture || (spotify.standalone && !mp3Export.busy && !recording && !deletingAudio && !!firstCapturedTrack);
  const openTrack = useCallback((id: string, rowIndex?: number, allowCaptured = false) => {
    const track = tracks.find(track => track.id === id);
    if (!track || (!allowCaptured && track.status !== 'ready') || deleting.current || (recording && selected !== id)) return;
    if (selected !== id || selectedRowIndex !== rowIndex) { loadedRevision.current = ''; setRecord(null); setSelected(id); setSelectedRowIndex(rowIndex ?? null); viewScroll.current.player = 0; }
    pauseForEntry(); syncTrackUrl(id, false, rowIndex);
    setViewMode('player');
  }, [tracks, recording, selected, selectedRowIndex, pauseForEntry, syncTrackUrl]);
  const onLogoClick = useCallback(() => {
    if (viewMode === 'player') {
      setViewMode('tracks');
      if (urlNavigation) setUrlView(null, urlNavigation.revision, false);
      return;
    }
    if (!canUseLogo) return;
    if (firstCapturedTrack) { openTrack(`spotify-${firstCapturedTrack.trackId}`, firstCapturedTrack.rowIndex, true); return; }
    capture.toggle();
  }, [viewMode, urlNavigation, setUrlView, canUseLogo, firstCapturedTrack, openTrack, capture]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) return;
      if (event.key === 'Enter' && viewMode === 'tracks' && canUseLogo) { event.preventDefault(); onLogoClick(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [close, viewMode, canUseLogo, onLogoClick]);
  useSpacePlayback(() => {
    if (mp3Export.busy) return;
    if (replay.active) { void replay.togglePause(); return; }
    if (spotify.replay) { if (replayReady && !capture.active && !active) replay.start(); return; }
    if (!capture.active && mixer.current?.ready) {
      void mixer.current.togglePlayback?.().catch(reason => setError(errorText(reason)));
      return;
    }
  });
  const startExport = (value: PerformanceRecording) => {
    if (running.current || deleting.current || modelBusy.current || mix.current || replay.active || capture.active || spotify.starting) { setError('Wait for capture, separation, or recording to finish before exporting.'); return; }
    void mp3Export.start(value);
  };
  const stoppedByUser = !error && /^Capture run stopped by user\.?$/.test(spotify.error);
  const statusError = !!mp3Export.error || !!replay.error || !!error || (!!spotify.error && !stoppedByUser);
  const statusMessage = mp3Export.error || replay.error || error || (stoppedByUser ? 'Capture stopped.' : spotify.error) ||
    (!spotify.tracksComplete ? 'Loading playlist…' : spotify.starting ? 'Starting capture…' : capture.active ? 'Capturing songs as they play…' :
      spotify.notice.replace(' Local separation is queued automatically.', '').replace(' Separation continues here automatically.', ''));
  return <main className={`iframe-page iframe-page--overlay${viewMode === 'player' ? ' iframe-page--player' : ''}`} aria-label="ktv420 playlist"
    ref={page} onScroll={event => { if (event.target === event.currentTarget) viewScroll.current[viewMode] = event.currentTarget.scrollTop; }}>
    <header className="iframe-overlay-header">
    <div className="iframe-status-slot">
      {statusMessage && <p className="iframe-status-message" data-kind={statusError ? 'error' : 'notice'} role={statusError ? 'alert' : 'status'}>
        <OverlayIcon name={statusError ? 'alert' : 'music'} /><span>{statusMessage}</span>
      </p>}
    </div>
    <div className="iframe-actions-shell"><div className="iframe-actions">
      <button type="button" className="iframe-close-button" aria-label={viewMode === 'player' || viewMode === 'settings' && previousView.current === 'player' ? 'Back to playlist' : 'Back to catalog'} title={viewMode === 'player' || viewMode === 'settings' && previousView.current === 'player' ? 'Back to playlist' : 'Back to catalog'} onClick={close}><OverlayIcon name="close" /></button>
      <button type="button" className="iframe-logo-button" aria-label={viewMode === 'player' ? 'Back to playlist' : firstCapturedTrack ? 'Open first track' : spotify.standalone ? 'No prepared tracks' : 'Start or stop ktv420 capture'}
        title={viewMode === 'player' ? 'Back to playlist' : firstCapturedTrack ? 'Open first track' : spotify.standalone ? 'No prepared tracks' : capture.active ? 'Stop capture' : 'Start capture'}
        aria-disabled={viewMode !== 'player' && !canUseLogo} disabled={viewMode !== 'player' && !canUseLogo}
        aria-pressed={viewMode === 'player' || firstCapturedTrack ? undefined : capture.active} onClick={onLogoClick}><img alt="" src={`${import.meta.env.BASE_URL}favicon.svg`} /></button>
      <button type="button" className="iframe-settings-button" aria-label="Toggle settings view" title={viewMode === 'settings' ? 'Back to music' : 'Settings'}
        aria-pressed={viewMode === 'settings'} onClick={toggleSettings}><OverlayIcon name="settings" /></button>
    </div>
    <label className="iframe-master-volume"><span>Volume <output>{Math.round(masterVolume * 100)}%</output></span>
      <input type="range" min="0" max="1" step="0.01" aria-label="Listening volume" value={masterVolume}
        onChange={event => { const volume = Number(event.target.value); setMasterVolume(volume); transportCommand({action:'volume',volume}); }} />
      <small>{capture.active ? 'Capture' : record ? 'Stems' : 'Muted'}</small>
    </label></div>
    </header>
    <div className="iframe-content">
      {spotify.standalone && spotify.spotifyPath && viewMode === 'tracks' && <nav className="iframe-capture-link"><a href={collectionLink(spotify.spotifyPath)} target="_blank" rel="noreferrer">{spotify.tracks.some(row => !tracks.some(track => track.id === `spotify-${row.trackId}`)) ? 'Continue capturing in Spotify' : 'Open in Spotify'} ↗</a></nav>}
    {spotify.replay && <section className="replay-card" aria-label="Shared recording">
      <div><h2>{spotify.replay.name}</h2><p>{replay.active ? `${Math.floor(replay.seconds)}s · ${replay.status === 'preparing' ? 'Preparing song…' : replay.status === 'paused' ? 'Paused' : 'Replaying'}` : replayReady ? 'Ready to replay.' : 'Capture missing songs, then let separation finish.'}</p></div>
      {replay.active ? <><button disabled={replay.status==='preparing' || replay.busy} onClick={() => void replay.togglePause()}>{replay.status==='paused' ? 'Resume recording' : 'Pause recording'}</button><button onClick={replay.stop}>Stop replay</button></> : <button disabled={!replayReady || capture.active || !!active || mp3Export.busy} onClick={replay.start}>Play recording</button>}
      <ReplayExportButton progress={mp3Export.progress} disabled={audioBusy || !replayReady} onExport={() => startExport(spotify.replay!)} onCancel={mp3Export.cancel}/>
      {!replay.active && <button disabled={mp3Export.busy} onClick={spotify.dismissReplay}>Leave recording</button>}
      {required.some(item => tracks.some(t => t.id===`spotify-${item.id}` && t.status==='ready' && Math.abs(t.frames/t.sampleRate+captureStartSeconds(t.metadata)-item.duration)>=1)) && <p>A saved song has a different duration. Delete that song in Settings, then capture it again.</p>}
      {!spotify.tracks.length && <p>Sign in to Spotify, then refresh this page.</p>}
      {!replayReady && <p>{required.filter(item => !tracks.some(t => t.id===`spotify-${item.id}` && t.status==='ready')).length} of {required.length} songs still need preparation.{!autoProcessing && ' Resume separation in Settings.'}</p>}
    </section>}
    {!recording && savedMix && !spotify.replay && <section className="replay-card" aria-label="Saved recording"><div><h2>Recording saved</h2><p>Send your friend the JSON and ktv420.web.app/replay.</p></div>
      <ReplayExportButton progress={mp3Export.progress} disabled={audioBusy} onExport={() => startExport(savedMix)} onCancel={mp3Export.cancel}/>
      <button onClick={() => downloadBlob(new Blob([JSON.stringify(savedMix)],{type:'application/json'}),`${savedMix.name}.json`)}>Download JSON</button>
      <button onClick={() => { void navigator.clipboard.writeText('https://ktv420.web.app/replay').catch(() => setError('Share this link: https://ktv420.web.app/replay')); }}>Copy replay link</button>
    </section>}
    {viewMode === 'settings' && <section className="iframe-settings-view" aria-label="Settings view">
      <section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Separation</h2><span>On your computer</span></header>
        <p className="iframe-settings-help">Turn captured songs into vocals, drums, bass, and other sounds.</p>
        <div className="iframe-setting-row">
          <div><h3>Automatic separation</h3><p id="separation-help">Capture continues while paused. Unfinished songs restart on resume.</p></div>
          <button disabled={deletingAudio} aria-describedby="separation-help" onClick={() => setProcessingEnabled(!autoProcessing)}>{autoProcessing ? 'Pause separation' : 'Resume separation'}</button>
        </div>
        {spotify.librarySummary.some(row => row.location !== 'website' && row.status === 'error') && <button onClick={() => void spotify.configureQueue(true, true).catch(reason => setError(errorText(reason)))}>Retry separation</button>}
        {active && <progress max={1} value={progress?.fraction || 0} aria-label="Separation progress" title={progress?.message} />}
        <div className="iframe-setting-row">
          <div><label htmlFor="separation-device">Processing device</label><p>Use CPU if GPU separation fails.</p></div>
          <select id="separation-device" value={backend} disabled={!!active || queueBusy || deletingAudio} onChange={event => { const value = event.target.value as 'auto' | 'wasm'; setBackend(value); if (spotify.queueEnabled !== null) void spotify.configureQueue(autoProcessing, false, value).catch(reason => setError(errorText(reason))); }}>
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
        <header className="iframe-settings-source-header"><h2><a href={catalogUrl()} target="_blank" rel="noreferrer">Local audio</a></h2><span>{size(tracks.reduce((total, track) => total + track.bytes, 0))}</span></header>
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
          <div className="iframe-settings-row"><span className="iframe-settings-kind" data-ready={track.status === 'ready'} role="img" aria-label={track.status === 'ready' ? 'Original + 4 stems' : 'Original only'} title={track.status === 'ready' ? 'Original + 4 stems' : 'Original only'}><OverlayIcon name="music" /></span><span className="iframe-settings-path">{track.title}</span>
            <span className="iframe-settings-size">{size(track.bytes)}</span><span className="iframe-settings-row-actions">
              {track.status === 'error' && <button className="iframe-settings-icon-button" disabled={!!active || deletingAudio} title="Retry separation" aria-label={`Retry ${track.title}`} onClick={() => { if (track.source === 'spotify' && spotify.queueEnabled !== null) void spotify.configureQueue(true, true).catch(reason => setError(errorText(reason))); else void processTracks([track.id]); }}><OverlayIcon name="retry" /></button>}
              {confirmDelete === track.id ? <><button disabled={audioBusy} onClick={() => void remove(track.id)}>Delete</button><button onClick={() => setConfirmDelete('')}>Cancel</button></> :
                <button className="iframe-settings-icon-button" disabled={audioBusy} title="Delete audio" aria-label={`Delete ${track.title}`} onClick={() => { setConfirmDeleteAll(false); setConfirmDelete(track.id); }}><OverlayIcon name="trash" /></button>}
            </span></div>
        </li>)}</ol>
      </section>
    </section>}
    {viewMode === 'tracks' && <ol className="iframe-track-list" aria-label="Playlist tracks">
      {displayTracks.map((track, index) => {
        const staged = spotify.librarySummary.find(row => row.id === track.id && row.location !== 'website');
        const queueStatus = staged ? separationStatus(staged, autoProcessing, staged.error) : null;
        const ready = track.status === 'ready';
        const available = ready && !mp3Export.busy && !deletingAudio && (!recording || selected === track.id);
        const capture = spotify.captureProgress?.trackId === track.id.replace(/^spotify-/, '') ? spotify.captureProgress : null;
        const saving = capture?.phase === 'saving' || track.status === 'missing' && spotify.savingTrackIds.includes(track.id.replace(/^spotify-/, ''));
        const separating = !ready && (active === track.id || !!queueStatus?.busy);
        const progressKind = !ready && (capture || saving) ? 'capture' : separating ? 'separation' : undefined;
        const fraction = progressKind === 'capture' ? saving ? .99 : capture!.fraction : active === track.id ? separationFraction : staged?.progress?.fraction ?? null;
        const label = ready ? 'Ready' : staged ? staged.status === 'ready' ? 'Importing finished stems…' : queueStatus!.label : saving ? 'Saving…' : progressKind === 'capture' ? `Capturing${fraction === null ? '' : ` ${Math.floor(fraction * 100)}%`}`
          : separating ? separationProgressLabel(progress?.message || 'Starting separation worker', fraction)
          : track.status === 'error' ? 'Failed' : track.status === 'missing' ? missingTrackLabel(libraryReady, spotify.summaryReady, spotify.librarySummary.find(row => row.id === track.id)) : !autoProcessing ? 'Separation paused' : 'Queued';
        const icon = ready ? 'play' : track.status === 'error' || queueStatus?.failed ? 'alert' : progressKind ? 'processing' : 'clock';
        const artwork = (typeof track.metadata?.trackArtworkSrc === 'string' ? track.metadata.trackArtworkSrc : '') ||
          spotify.tracks.find(item => `spotify-${item.trackId}` === track.id)?.trackArtworkSrc || '';
        return <li key={`${track.id}-${index}`}><button type="button" className="iframe-track-row" data-state={track.status} data-progress={progressKind}
          aria-label={`${track.title} — ${queueStatus?.failed ? 'Retry separation' : label}`} disabled={!available && !queueStatus?.failed}
          title={staged?.progress?.message || staged?.error || track.error || (active === track.id ? progress?.message : available ? 'Open stem mixer' : label)}
          onClick={() => queueStatus?.failed ? void spotify.configureQueue(true, true).catch(reason => setError(errorText(reason))) : openTrack(track.id, spotify.replay ? undefined : spotify.tracks[index]?.rowIndex)}>
          {progressKind && <span className="iframe-track-fill" data-indeterminate={fraction === null} style={{ width: fraction === null ? '35%' : `${fraction * 100}%` }} aria-hidden="true" />}
          <span className="iframe-track-state"><OverlayIcon name={icon} /></span>
          {artwork ? <img className="iframe-track-artwork" alt="" src={artwork} crossOrigin="anonymous" /> : <span className="iframe-track-artwork iframe-artwork-placeholder"><OverlayIcon name="music" /></span>}
          <span className="iframe-track-copy"><span className="iframe-track-name">{track.title}</span><span className="iframe-track-artist">{track.artist}</span></span>
          <span className="iframe-track-status">{queueStatus?.failed ? 'Retry separation' : label}</span>
        </button></li>;
      })}
    </ol>}
    <PlayerViewport contentKey={activeTrack && record && record.md5 === selected ? `${record.md5}/${selectedRowIndex}` : null} hidden={viewMode !== 'player'}>
    {activeTrack && record && record.md5 === selected && <>
      <div className={replay.active ? "replay-mixer" : undefined} inert={!!spotify.replay || mp3Export.busy}><Player keyboardPlayback={false} key={`${record.md5}/${selectedRowIndex}/${spotify.replay ? 'replay' : 'manual'}`} record={record} title={activeTrack.title} replaying={replay.active || mp3Export.busy} onControls={onControls}
        combinedVisualizerExpanded={combinedVisualizerExpanded} onCombinedVisualizerExpandedChange={setCombinedVisualizerExpanded}
        initialSettings={spotify.replay ? undefined : mixerSettings.current} onSettingsChange={spotify.replay ? undefined : rememberMixerSettings}
        masterVolume={capture.active ? 0 : masterVolume}
        tempoSupported
        onPlaybackError={onPlaybackError}
        hasPreviousTrack={!recording && selectedIndex > 0} hasNextTrack={!recording && selectedIndex >= 0 && selectedIndex < playbackTracks.length - 1}
        onPreviousTrack={() => navigateTrack(-1)} onNextTrack={() => navigateTrack(1)} onTrackEnd={() => navigateTrack(1)}
        autoPlayOnReady={autoPlay} onAutoPlayOnReadyHandled={() => setAutoPlay(false)} trackMetadata={activeTrack.metadata} isRecording={recording}
        onStartRecording={startRecording} onStopRecording={stopRecording} onRecordingEvent={recordEvent} onRegisterRecordingFlush={callback => { flush.current = callback; }} /></div>
      <details className="iframe-player-exports"><summary>Export audio</summary>{record.files.map(file => <button key={file.path}
        onClick={() => downloadBlob(file.blob, `${activeTrack.title}-${file.name}`)}>{file.name.replace(/\.(wav|mp3)$/i, '')}</button>)}</details>
    </>}
    </PlayerViewport>
    </div>
  </main>;
}

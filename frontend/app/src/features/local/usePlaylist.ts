import { useCallback, useEffect, useRef, useState } from 'react';
import { savedCollection, type TrackRow } from './collections';
import { playlistPath, playlistIndex, playlistViewUrl } from './playlistPage';
import { spotifyRequest } from './spotify/client';
import { embeddedSpotify, overlayReady } from './spotify/overlay';
import { loadPlaylistCollection } from './spotify/collectionDelivery';
import type { LibrarySummary } from '../../shared/librarySummary';
import { loadPerformance } from './performanceFiles';
import type { PerformanceRecording } from './recording';
import type { CaptureProgress } from './captureProgress';
import { discoverPlaylist, type PlaylistSnapshot } from './spotify/discover';
export type SpotifyTrack = TrackRow;
type Status = {
  request: { id: string; state: string; error: string } | null;
  active: boolean;
  progress: CaptureProgress | null;
  volume: number | null;
  error: string;
};
const params = new URLSearchParams(location.search),
  path = playlistPath(params.get('id')) || '';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function usePlaylist(onClose?: () => void) {
  const [tracks, setTracks] = useState<TrackRow[]>([]),
    [complete, setComplete] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState<Status | null>(null);
  const [navigation, setNavigation] = useState({
    open: true,
    trackIndex: playlistIndex(location.search),
    revision: 0,
  });
  const [replay, setReplay] = useState<PerformanceRecording | null>(null);
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary[]>([]);
  const [summaryReady, setSummaryReady] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState<boolean | null>(null);
  const [queueBackend, setQueueBackend] = useState<'auto' | 'wasm' | null>(null);
  const cancelled = useRef(false),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [savingTrackIds, setSavingTrackIds] = useState<string[]>([]);
  const volumeRevision = useRef(0), volumePending = useRef(0);
  const active = status?.active === true;
  useEffect(() => {
    let disposed = false;
    void spotifyRequest('hello', { heal: true }).catch(() => {});
    const load = async () => {
      try {
        let collection;
        if (embeddedSpotify) {
          const snapshot = await discoverPlaylist(path,
            () => spotifyRequest<PlaylistSnapshot>('discover'), () => disposed);
          if (!snapshot) return;
          // The overlay holds metadata only; the website registers delivered captures.
          collection = { ...snapshot.collection, tracks: snapshot.tracks };
        } else {
          // Render cached rows (or just their small metadata handoff) immediately.
          // AppServices imports audio in the background; ready tracks appear as it commits.
          collection = await loadPlaylistCollection(path);
        }
        if (!disposed) {
          setTracks(collection.tracks);
          setComplete(true);
          setError('');
          document.title = `${collection.title} · ktv420`;
        }
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
          // The capture frame must never consult its isolated audio database.
          if (embeddedSpotify) return;
          try {
            const c = await savedCollection(path);
            setTracks(c.tracks);
            setComplete(true);
          } catch {
            /* the visible error explains the missing collection */
          }
        }
      }
    };
    void load();
    if (!embeddedSpotify && params.has('replay'))
      void loadPerformance('import').then((value) => {
        if (!disposed) setReplay(value);
      });
    const refreshRows = () => { if (!embeddedSpotify) void savedCollection(path).then(c => { if (!disposed) { setTracks(previous => JSON.stringify(previous) === JSON.stringify(c.tracks) ? previous : c.tracks); setComplete(true); } }).catch(() => {}); };
    const rowsTimer = setInterval(refreshRows, 2500);
    const pop = () =>
      setNavigation((n) => ({
        open: true,
        trackIndex: playlistIndex(location.search),
        revision: n.revision + 1,
      }));
    window.addEventListener('popstate', pop);
    return () => {
      disposed = true; clearInterval(rowsTimer);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        if (embeddedSpotify) {
          const revision = volumeRevision.current;
          const next = await spotifyRequest<Status>('status');
          if (!disposed) setStatus(previous => ({ ...next, volume: volumePending.current || revision !== volumeRevision.current ? previous?.volume ?? next.volume : next.volume }));
        }
        const summary = await spotifyRequest<LibrarySummary[]>('library-summary');
        if (!disposed) {
          setLibrarySummary(summary); setSummaryReady(true);
          setError('');
          const ids = new Set(summary.map(track => track.id.replace(/^spotify-/, '')));
          setSavingTrackIds(previous => previous.filter(id => !ids.has(id)));
        }
        const state = await spotifyRequest<{ enabled: boolean; backend?: 'auto' | 'wasm' }>('work-state').catch(() => null);
        if (!disposed && state) { setQueueEnabled(state.enabled); setQueueBackend(state.backend || 'auto'); }
      } catch (reason) {
        if (!disposed && embeddedSpotify) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!disposed) setSummaryReady(true);
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!embeddedSpotify) return;
    const navigation = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail.open) {
        setNavigation(n => ({ ...n, open: false, revision: n.revision + 1 }));
        cancelled.current = true;
        closeRef.current?.();
        window.dispatchEvent(new Event('ktv420:overlay-hidden'));
        return;
      }
      const revision = volumeRevision.current;
      void spotifyRequest<Status>('status').then(next => {
        if (revision === volumeRevision.current && !volumePending.current) setStatus(next);
      }).catch(reason => setError(String(reason)));
      const index = Number.isSafeInteger(detail.trackIndex) && detail.trackIndex > 0 && detail.trackIndex <= 10000 ? detail.trackIndex : null;
      const href = playlistViewUrl(location.href, index);
      if (href !== location.href) history.replaceState(history.state, '', href);
      setNavigation(n => ({ open: true, trackIndex: index, revision: n.revision + 1 }));
    };
    window.addEventListener('ktv420:overlay-navigation', navigation);
    overlayReady();
    const title = new MutationObserver(() => {
      void spotifyRequest('presentation', { title: document.title.slice(0, 500) }).catch(() => {});
    });
    title.observe(document.querySelector('title')!, { childList: true, subtree: true, characterData: true });
    return () => { window.removeEventListener('ktv420:overlay-navigation', navigation); title.disconnect(); };
  }, []);
  const cancelCapture = useCallback(() => {
    cancelled.current = true;
    if (embeddedSpotify)
      void spotifyRequest('cancel').catch((reason) => setError(String(reason)));
  }, []);
  const captureOne = useCallback(async (trackId: string) => {
    if (!embeddedSpotify)
      throw new Error('Open this playlist from the Spotify extension to capture.');
    cancelled.current = false;
    const requestId = crypto.randomUUID();
    await spotifyRequest('capture', { trackId, requestId, path });
    while (!cancelled.current) {
      const next = await spotifyRequest<Status>('status');
      setStatus(previous => ({ ...next, volume: previous?.volume ?? next.volume }));
      if (next.request?.id !== requestId) throw new Error('Spotify capture was replaced.');
      if (next.request.state === 'error') throw new Error(next.request.error);
      if (next.request.state === 'complete') {
        setSavingTrackIds((previous) => [...new Set([...previous, trackId])]);
        return;
      }
      await delay(1000);
    }
    throw new Error('Capture stopped.');
  }, []);
  const transport = useCallback((command: { action: 'volume'; volume: number }) => {
    if (command.action !== 'volume' || !embeddedSpotify) return;
    const revision = ++volumeRevision.current;
    volumePending.current++;
    setStatus(previous => previous ? { ...previous, volume: command.volume } : previous);
    void spotifyRequest<Status>('volume', { volume: command.volume })
      .then(next => { if (revision === volumeRevision.current) setStatus(next); })
      .catch(reason => setError(String(reason)))
      .finally(() => { volumePending.current--; });
  }, []);
  const setView = useCallback((index: number | null, _revision: number, replace = false) => {
    const href = playlistViewUrl(location.href, index);
    if (href !== location.href)
      history[embeddedSpotify || replace ? 'replaceState' : 'pushState'](history.state, '', href);
    if (embeddedSpotify) void spotifyRequest('view', { trackIndex: index, replace }).catch(reason => setError(String(reason)));
    // An internal transition is already handled by the mixer; only popstate increments revision.
    setNavigation((n) => ({ ...n, trackIndex: index }));
  }, []);
  return {
    tracks,
    librarySummary,
    queueEnabled,
    queueBackend,
    configureQueue: async (enabled: boolean, retry = false, backend?: 'auto' | 'wasm') => { await spotifyRequest('work-config', { enabled, retry, ...(backend ? { backend } : {}) }); setQueueEnabled(enabled); if (backend) setQueueBackend(backend); },
    summaryReady,
    openPlayer: (trackIndex: number | null) => spotifyRequest('open-player', { path, trackIndex }),
    tracksComplete: complete,
    error,
    notice: '',
    spotifyPath: path,
    navigation,
    active,
    starting: false,
    supported: !!path,
    captureProgress: status?.progress || null,
    savingTrackIds,
    replay,
    standalone: !embeddedSpotify,
    captureVolume: status?.volume,
    captureOne,
    cancelCapture,
    setView,
    transport,
    dismissReplay: () => setReplay(null),
    close: () => {
      closeRef.current?.();
      cancelled.current = true;
      if (embeddedSpotify) void spotifyRequest('close').catch(reason => setError(String(reason)));
      else location.assign('/catalog');
    },
    acknowledgeSaved: useCallback((ids: string[]) => {
      setSavingTrackIds((previous) => previous.filter((id) => !ids.includes(id)));
    }, []),
  };
}

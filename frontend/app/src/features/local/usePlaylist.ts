import { useCallback, useEffect, useRef, useState } from 'react';
import { savedCollection, rememberCollection, type TrackRow } from './collections';
import { playlistPath, playlistIndex, playlistViewUrl } from './playlistPage';
import { spotifyRequest } from './spotify/client';
import { drainDeliveries } from './spotify/delivery';
import { getTrack } from './library';
import { loadPerformance } from './performanceFiles';
import type { PerformanceRecording } from './recording';
import type { CaptureProgress } from './captureProgress';
import type { Collection } from './savedCollections';
export type SpotifyTrack = TrackRow;
type Status = {
  request: { id: string; state: string; error: string } | null;
  active: boolean;
  progress: CaptureProgress | null;
  volume: number;
  error: string;
};
const params = new URLSearchParams(location.search),
  path = playlistPath(params.get('id')) || '';
const rawTab = params.get('spotifyTab'),
  tabId = rawTab && /^\d+$/.test(rawTab) ? Number(rawTab) : null;
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
  const cancelled = useRef(false),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [savingTrackIds, setSavingTrackIds] = useState<string[]>([]);
  const active = status?.active === true;
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        let collection;
        if (tabId !== null) {
          const snapshot = await spotifyRequest<{
            collection: Collection;
            tracks: TrackRow[];
            complete: boolean;
          }>('discover', { tabId });
          if (snapshot.collection.path !== path)
            throw new Error(
              'Spotify is showing a different playlist. Open ktv420 from that page again.',
            );
          if (!snapshot.complete)
            throw new Error(
              'Spotify’s complete track list is not available yet. Refresh to retry.',
            );
          await rememberCollection(snapshot.collection, snapshot.tracks);
          collection = { ...snapshot.collection, tracks: snapshot.tracks };
        } else collection = await savedCollection(path);
        if (!disposed) {
          setTracks(collection.tracks);
          setComplete(true);
          setError('');
          document.title = `${collection.title} · ktv420`;
        }
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
          // An unavailable capture connection must never block already saved music.
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
    if (params.has('replay'))
      void loadPerformance('import').then((value) => {
        if (!disposed) setReplay(value);
      });
    const pop = () =>
      setNavigation((n) => ({
        open: true,
        trackIndex: playlistIndex(location.search),
        revision: n.revision + 1,
      }));
    window.addEventListener('popstate', pop);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    if (tabId === null) return;
    let disposed = false,
      busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await spotifyRequest<Status>('status', { tabId });
        if (!disposed) setStatus(next);
        await drainDeliveries();
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
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
  const cancelCapture = useCallback(() => {
    cancelled.current = true;
    if (tabId !== null)
      void spotifyRequest('cancel', { tabId }).catch((reason) => setError(String(reason)));
  }, []);
  const captureOne = useCallback(async (trackId: string) => {
    if (tabId === null)
      throw new Error('Open this playlist from the Spotify extension to capture.');
    cancelled.current = false;
    const requestId = crypto.randomUUID();
    await spotifyRequest('capture', { tabId, trackId, requestId, path });
    while (!cancelled.current) {
      const next = await spotifyRequest<Status>('status', { tabId });
      setStatus(next);
      if (next.request?.id !== requestId) throw new Error('Spotify capture was replaced.');
      if (next.request.state === 'error') throw new Error(next.request.error);
      if (next.request.state === 'complete') {
        setSavingTrackIds((previous) => [...new Set([...previous, trackId])]);
        do {
          await drainDeliveries();
          if (await getTrack(`spotify-${trackId}`)) return;
          await delay(500);
        } while (!cancelled.current);
      }
      await delay(1000);
    }
    throw new Error('Capture stopped.');
  }, []);
  const transport = useCallback((command: { action: 'volume'; volume: number }) => {
    if (command.action === 'volume' && tabId !== null)
      void spotifyRequest('volume', { tabId, volume: command.volume }).catch((reason) =>
        setError(String(reason)),
      );
  }, []);
  const setView = useCallback((index: number | null, _revision: number, replace = false) => {
    const href = playlistViewUrl(location.href, index);
    if (href !== location.href)
      history[replace ? 'replaceState' : 'pushState'](history.state, '', href);
    // An internal transition is already handled by the mixer; only popstate increments revision.
    setNavigation((n) => ({ ...n, trackIndex: index }));
  }, []);
  return {
    tracks,
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
    standalone: tabId === null,
    captureVolume: status?.volume,
    captureOne,
    cancelCapture,
    setView,
    transport,
    dismissReplay: () => setReplay(null),
    close: () => {
      closeRef.current?.();
      location.assign('/catalog');
    },
    acknowledgeSaved: useCallback((ids: string[]) => {
      setSavingTrackIds((previous) => previous.filter((id) => !ids.includes(id)));
    }, []),
  };
}

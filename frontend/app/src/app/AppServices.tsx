import { useEffect, useState } from 'react';
import { embeddedSpotify } from '../features/local/spotify/overlay';
import { drainDeliveries } from '../features/local/spotify/delivery';
import {
  getProcessingEnabled,
  requestPersistence,
  withProcessingLock,
} from '../features/local/libraryClient';
import { listTracks } from '../features/local/library';
import { processLocalTrack } from '../features/local/processing';
import { LocalSeparator } from '../features/local/inference/client';
import { drainSpotifyQueue } from '../features/local/spotifyQueue';
/** Reconnect delivery on any website page; no installed extension is needed for the library. */
export default function AppServices() {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (embeddedSpotify) return;
    let cancelled = false,
      busy = false,
      processingCancelled = false,
      separator: LocalSeparator | null = null;
    void requestPersistence()
      .then((persistent) => {
        if (!cancelled && !persistent)
          setNotice(
            'Storage is not persistent. Browser cleanup can remove saved music; export playlists to keep a copy.',
          );
      })
      .catch(() => {});
    const tick = async () => {
      if (busy) {
        // A settings page can pause the worker owned by a different website tab.
        const current = separator;
        if (current) {
          try {
            if (!(await getProcessingEnabled()) && separator === current) {
              processingCancelled = true;
              current.dispose();
            }
          } catch { /* The active operation reports storage failures. */ }
        }
        return;
      }
      busy = true;
      try {
        // A missing extension is normal. Only surface delivery failures after a successful hello.
        const { spotifyRequest } = await import('../features/local/spotify/client');
        let connected = false;
        try {
          await spotifyRequest('hello');
          connected = true;
        } catch {
          /* website works independently */
        }
        if (connected)
          try {
            await drainDeliveries();
            if (!cancelled) setNotice(previous => previous.startsWith('Capture delivery paused:') ? '' : previous);
          } catch (reason) {
            if (!cancelled)
              setNotice(
                `Capture delivery paused: ${reason instanceof Error ? reason.message : String(reason)}`,
              );
          }
        // PlaylistPage has its own progress UI; both paths share the same website lock.
        if (location.pathname !== '/playlist' && (await getProcessingEnabled()) && !cancelled)
          await withProcessingLock(async (acquired) => {
            if (!acquired || cancelled) return;
            processingCancelled = false;
            separator = new LocalSeparator({ backend: 'gpu' in navigator ? 'webgpu' : 'wasm' });
            try {
              await drainSpotifyQueue({
                list: listTracks,
                cancelled: () => cancelled || processingCancelled,
                process: (id) =>
                  processLocalTrack(
                    id,
                    separator!,
                    () => cancelled || processingCancelled,
                    () => {},
                  ),
                onError: (reason) => {
                  if (!cancelled) setNotice(String(reason));
                },
              });
            } finally {
              separator.dispose();
              separator = null;
            }
          });
      } catch (reason) {
        if (!cancelled) setNotice(reason instanceof Error ? reason.message : String(reason));
      } finally {
        busy = false;
      }
    };
    const publish = async () => {
      try {
        const { spotifyRequest } = await import('../features/local/spotify/client');
        const tracks = (await listTracks()).filter(t => t.source === 'spotify').map(({ id, status }) => ({ id, status }));
        await spotifyRequest('publish-library', { tracks });
      } catch { /* Capture extension is optional. */ }
    };
    void publish();
    const summaryTimer = setInterval(() => void publish(), 2500);
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(summaryTimer);
      separator?.dispose();
    };
  }, []);
  return notice ? (
    <aside className="storage-notice" role="status">
      {notice}
      <button onClick={() => setNotice('')} aria-label="Dismiss storage notice">
        ×
      </button>
    </aside>
  ) : null;
}

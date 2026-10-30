import { useEffect, useState } from 'react';
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
    let cancelled = false,
      busy = false,
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
      if (busy) return;
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
            separator = new LocalSeparator({ backend: 'gpu' in navigator ? 'webgpu' : 'wasm' });
            try {
              await drainSpotifyQueue({
                list: listTracks,
                cancelled: () => cancelled,
                process: (id) =>
                  processLocalTrack(
                    id,
                    separator!,
                    () => cancelled,
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
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
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

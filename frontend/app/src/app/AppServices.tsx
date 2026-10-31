import { startStagedProcessing } from '../features/local/spotify/stagedProcessing';
import { useEffect, useState } from 'react';
import { embeddedSpotify } from '../features/local/spotify/overlay';
import { drainDeliveries } from '../features/local/spotify/delivery';
import {
  getProcessingEnabled,
  requestPersistence,
} from '../features/local/libraryClient';
import { libraryPublication } from '../features/local/libraryPublication';
/** Reconnect delivery on any website page; no installed extension is needed for the library. */
export default function AppServices() {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (embeddedSpotify) return;
    let cancelled = false,
      busy = false, checkedWorker = false,
      stopWorker: (() => void) | undefined;
    void requestPersistence()
      .then((persistent) => {
        if (!cancelled && !persistent)
          setNotice(
            'Storage is not persistent. Browser cleanup can remove saved music; export playlists to keep a copy.',
          );
      })
      .catch(() => {});
    const tick = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        // A missing extension is normal. Only surface delivery failures after a successful hello.
        const { spotifyRequest } = await import('../features/local/spotify/client');
        let connected = false, sharedLibrary = false;
        try {
          const capability = await spotifyRequest<{ extensionQueue?: boolean; backgroundQueue?: boolean; sharedLibrary?: boolean }>('hello', { heal: !checkedWorker });
          sharedLibrary = capability.sharedLibrary === true;
          checkedWorker = true;
          connected = true;
          if (capability.extensionQueue && !capability.backgroundQueue && !stopWorker && !cancelled) stopWorker = startStagedProcessing(message => { if (!cancelled) setNotice(message); }, () => {});
        } catch {
          /* website works independently */
        }
        if (connected && !sharedLibrary)
          try {
            await drainDeliveries();
            if (!cancelled) setNotice(previous => previous.startsWith('Storage is not persistent.') ? previous : '');
          } catch (reason) {
            if (!cancelled)
              setNotice(
                `Capture delivery paused: ${reason instanceof Error ? reason.message : String(reason)}`,
              );
          }
      } catch (reason) {
        if (!cancelled) setNotice(reason instanceof Error ? reason.message : String(reason));
      } finally {
        busy = false;
      }
    };
    let publishing = false;
    const publish = async () => {
      if (publishing || cancelled) return; publishing = true;
      try {
        const { spotifyRequest } = await import('../features/local/spotify/client');
        const enabled = await getProcessingEnabled();
        const snapshot = await libraryPublication();
        const tracks = snapshot.tracks.map(({ id, status }) => ({ id, status,
          ...(status !== 'ready' ? { separation: status === 'error' ? 'error' : !enabled ? 'paused' : status === 'processing' ? 'processing' : 'queued' } : {}),
        }));
        await spotifyRequest('publish-library', { tracks, revision: snapshot.revision });
      } catch { /* Capture extension is optional. */ } finally { publishing = false; }
    };
    void publish();
    const summaryTimer = setInterval(() => void publish(), 2500);
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(summaryTimer);
      stopWorker?.();
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

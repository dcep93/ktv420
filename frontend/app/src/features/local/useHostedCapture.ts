import { useCallback, useEffect, useRef, useState } from 'react';
import { HostedCaptureQueue } from './hostedCapture';
import type { usePlaylist } from './usePlaylist';
import type { LocalTrack } from './library';
import { readCaptureIntent, saveCaptureIntent } from './captureIntent';
type Options = {
  spotify: ReturnType<typeof usePlaylist>;
  tracks: Pick<LocalTrack, 'id'>[];
  libraryReady: boolean;
  required: { id: string }[];
  replaying: boolean;
  onError: (message: string) => void;
};
export function useHostedCapture(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const queue = useRef(new HostedCaptureQueue()),
    [active, setActive] = useState(false);
  const recovered = useRef(false);
  const mounted = useRef(true);
  const cancel = useCallback(() => {
    queue.current.cancel();
    saveCaptureIntent(latest.current.spotify.spotifyPath, null);
    setActive(false);
    latest.current.spotify.cancelCapture();
  }, []);
  const start = useCallback((resumeIds?: string[]) => {
    const o = latest.current;
    if (queue.current.active) return;
    if (!o.libraryReady || !o.spotify.tracksComplete || o.spotify.standalone) return;
    void navigator.locks.request(
      'ktv420-capture-scheduler',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          latest.current.onError('Capture is already running in another ktv420 tab.');
          return;
        }
        o.onError('');
        const saved = new Set(o.tracks.map((t) => t.id.replace(/^spotify-/, '')));
        const ids = resumeIds || (o.required.length ? o.required.map(t => t.id) : o.spotify.tracks.map(t => t.trackId));
        saveCaptureIntent(o.spotify.spotifyPath, ids);
        try {
          await queue.current.run(
            ids,
            () => saved,
            async (id) => {
              await latest.current.spotify.captureOne(id);
              saved.add(id);
            },
            () => setActive(queue.current.active),
            { retries: 1, failed: (id, message) => {
              const title = latest.current.spotify.tracks.find(t => t.trackId === id)?.trackName || 'Song';
              latest.current.onError(`${title} needs recapture: ${message}`);
            } },
          );
        } catch (reason) {
          latest.current.onError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          if (mounted.current) saveCaptureIntent(o.spotify.spotifyPath, null);
          setActive(false);
        }
      },
    );
  }, []);
  const toggle = useCallback(() => {
    if (queue.current.active || latest.current.spotify.active) cancel();
    else start();
  }, [cancel, start]);
  useEffect(() => {
    if (recovered.current || !options.libraryReady || !options.spotify.tracksComplete || options.spotify.standalone) return;
    recovered.current = true;
    const intent = readCaptureIntent(options.spotify.spotifyPath);
    if (intent) start(intent);
  }, [options.libraryReady, options.spotify.tracksComplete, options.spotify.standalone, options.spotify.spotifyPath, start]);
  useEffect(() => {
    window.addEventListener('ktv420:overlay-hidden', cancel);
    return () => window.removeEventListener('ktv420:overlay-hidden', cancel);
  }, [cancel]);
  // Closing the website stops scheduling; the extension may finish its single in-flight recording.
  useEffect(
    () => () => {
      mounted.current = false;
      queue.current.cancel();
    },
    [],
  );
  return { active: active || options.spotify.active, toggle, cancel };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { HostedCaptureQueue } from './hostedCapture';
import type { usePlaylist } from './usePlaylist';
import type { LocalTrack } from './library';
type Options = {
  spotify: ReturnType<typeof usePlaylist>;
  tracks: LocalTrack[];
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
  const cancel = useCallback(() => {
    queue.current.cancel();
    setActive(false);
    latest.current.spotify.cancelCapture();
  }, []);
  const toggle = useCallback(() => {
    const o = latest.current;
    if (queue.current.active || o.spotify.active) {
      cancel();
      return;
    }
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
        try {
          await queue.current.run(
            o.required.length
              ? o.required.map((t) => t.id)
              : o.spotify.tracks.map((t) => t.trackId),
            () => saved,
            async (id) => {
              await latest.current.spotify.captureOne(id);
              saved.add(id);
            },
            () => setActive(queue.current.active),
          );
        } catch (reason) {
          latest.current.onError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setActive(false);
        }
      },
    );
  }, [cancel]);
  // Closing the website stops scheduling; the extension may finish its single in-flight recording.
  useEffect(
    () => () => {
      queue.current.cancel();
    },
    [],
  );
  return { active: active || options.spotify.active, toggle, cancel };
}

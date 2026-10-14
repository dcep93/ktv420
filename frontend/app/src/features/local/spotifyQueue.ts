import type { LocalTrack } from './library';

/** Called only while holding the extension-wide separation lock. */
export async function drainSpotifyQueue(options: {
  list: () => Promise<LocalTrack[]>;
  process: (id: string) => Promise<void>;
  cancelled: () => boolean;
  onError: (error: unknown) => void;
}): Promise<void> {
  const attempted = new Set<string>();
  while (!options.cancelled()) {
    // Read again after each track: Spotify can finish another capture during inference.
    const next = (await options.list())
      .filter(track => track.source === 'spotify' &&
        (track.status === 'captured' || track.status === 'processing') && !attempted.has(track.id))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next || options.cancelled()) return;
    attempted.add(next.id);
    try { await options.process(next.id); }
    catch (error) { options.onError(error); }
  }
}

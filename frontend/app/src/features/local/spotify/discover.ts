import type { TrackRow } from '../collections';
import type { Collection } from '../savedCollections';

export type PlaylistSnapshot = { collection: Collection; tracks: TrackRow[]; complete: boolean };

// Auto-open can beat Spotify's first render. Never persist that partial snapshot
// or require a manual refresh just because discovery ran before the rows existed.
export async function discoverPlaylist(
  path: string,
  request: () => Promise<PlaylistSnapshot>,
  cancelled: () => boolean,
  wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  now = Date.now,
): Promise<PlaylistSnapshot | null> {
  const deadline = now() + 60_000;
  while (!cancelled()) {
    const snapshot = await request();
    if (cancelled()) return null;
    if (snapshot.collection.path !== path)
      throw new Error('Spotify is showing a different playlist. Open ktv420 from that page again.');
    if (snapshot.complete && snapshot.tracks.length) return snapshot;
    if (now() >= deadline)
      throw new Error('Spotify’s complete track list is not available yet. Refresh to retry.');
    await wait(750);
  }
  return null;
}

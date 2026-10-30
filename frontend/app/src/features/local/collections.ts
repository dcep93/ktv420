import { listTracks, transaction, type LocalTrack } from './library';
import { parseCollection, summarizeCollections, type SavedCollection } from './savedCollections';
export type TrackRow = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
};
export type LibraryCollection = SavedCollection & { tracks?: TrackRow[] };
export function listCollections(): Promise<LibraryCollection[]> {
  return transaction(['collections'], 'readonly', (tx, done) => {
    const r = tx.objectStore('collections').getAll();
    r.onsuccess = () => done(r.result);
  });
}
export async function rememberCollection(value: unknown, rows?: TrackRow[]) {
  const collection = parseCollection(value);
  if (!collection) throw new Error('Invalid collection.');
  await transaction(['collections', 'settings'], 'readwrite', (tx) => {
    const store = tx.objectStore('collections'),
      r = store.get(collection.path);
    const deleted = tx.objectStore('settings').get(`deleted-collection/${collection.path}`);
    deleted.onsuccess = () => {
      if (deleted.result && (collection.observedAt || 0) <= deleted.result) return;
      if ((r.result?.observedAt || 0) > (collection.observedAt || 0)) return;
      store.put({
        ...collection,
        tracks: rows || r.result?.tracks,
        savedAt: r.result?.savedAt ?? Date.now(),
        startedAt: r.result?.startedAt ?? Date.now(),
      });
    };
  });
}
export async function savedCollections() {
  return summarizeCollections(await listCollections(), await listTracks());
}
export async function savedCollection(path: unknown) {
  if (typeof path !== 'string' || !/^(album|playlist)\/[A-Za-z0-9]{22}$/.test(path))
    throw new Error('Invalid playlist link.');
  const result = await transaction<{ collection?: LibraryCollection; tracks: LocalTrack[] }>(
    ['collections', 'tracks'],
    'readonly',
    (tx, done) => {
      const c = tx.objectStore('collections').get(path),
        t = tx.objectStore('tracks').getAll();
      t.onsuccess = () => done({ collection: c.result, tracks: t.result });
    },
  );
  const collection = result.collection;
  if (!collection) throw new Error('Import or capture this playlist to add it to your catalog.');
  const tracks = new Map(result.tracks.map((t) => [t.id, t]));
  return {
    ...collection,
    tracks: collection.trackIds.map((trackId, rowIndex) => {
      const t = tracks.get(`spotify-${trackId}`),
        row = collection.tracks?.find((r) => r.trackId === trackId);
      return {
        trackId,
        rowIndex,
        trackName: t?.title || row?.trackName || `Track ${rowIndex + 1}`,
        trackArtist: t?.artist || row?.trackArtist || '',
        trackArtworkSrc: String(
          t?.metadata?.trackArtworkSrc || row?.trackArtworkSrc || collection.artwork,
        ),
      };
    }),
  };
}
export async function deleteCollectionAudio(path: unknown) {
  const collection = await savedCollection(path);
  await navigator.locks.request('ktv420-separation', { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Pause separation before deleting audio.');
    const { deleteTracks } = await import('./library');
    const others = (await listCollections()).filter(c => c.path !== collection.path);
    const shared = new Set(others.flatMap(c => c.trackIds));
    await deleteTracks(collection.trackIds.filter(id => !shared.has(id)).map(id => `spotify-${id}`));
    await transaction(['collections', 'settings'], 'readwrite', tx => {
      tx.objectStore('collections').delete(collection.path);
      tx.objectStore('settings').put(Date.now(), `deleted-collection/${collection.path}`);
    });
  });
}

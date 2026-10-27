import { listTracks } from '../features/local/library';
import { parseCollection, summarizeCollections, type Collection } from '../features/local/savedCollections';
import { readState, updateState } from './state';

export async function rememberCollection(value: unknown, started = false) {
  const collection = parseCollection(value);
  if (!collection) throw new Error('Invalid Spotify collection.');
  const tracks = await listTracks();
  const hasAudio = summarizeCollections([{ ...collection, savedAt: 0 }], tracks).length > 0;
  await updateState('collections', previous => {
    const found = previous?.find(item => item.path === collection.path);
    if (!started && !found?.startedAt && !hasAudio) return previous;
    // Keep names/covers when Spotify is still loading its header; ordinary visits
    // do not reorder an already saved collection.
    return [...(previous || []).filter(item => item.path !== collection.path), {
      ...collection, trackIds: [...new Set([...(found?.trackIds || []), ...collection.trackIds])], title: collection.title || found?.title || '', artwork: collection.artwork || found?.artwork || '', savedAt: found?.savedAt ?? Date.now(),
      ...(found?.startedAt || started ? { startedAt: found?.startedAt ?? Date.now() } : {}),
    }];
  });
}
export async function setCaptureContext(tabId: number, value: unknown, senderUrl: string, started = false): Promise<Collection> {
  const collection = parseCollection(value);
  if (!collection || new URL(senderUrl).pathname.replace(/\/$/, '') !== `/${collection.path}`) throw new Error('Spotify collection does not match this tab.');
  await updateState('captureContexts', previous => Object.fromEntries([
    ...Object.entries(previous || {}).filter(([id]) => id !== String(tabId)).slice(-63), [String(tabId), collection],
  ]));
  await rememberCollection(collection, started);
  return collection;
}
export async function savedCollections() {
  const [collections, tracks, contexts] = await Promise.all([readState('collections'), listTracks(), readState('captureContexts')]);
  // Older captures may have saved their context/audio while losing the separate
  // registry write. Recover only known membership with actual local audio.
  const known = new Set(collections?.map(item => item.path));
  const audio = new Set(tracks.map(track => track.id));
  const recoverable = Object.values(contexts || {}).map(parseCollection).filter((item): item is Collection =>
    !!item && !known.has(item.path) && item.trackIds.some(id => audio.has(`spotify-${id}`)));
  const repaired = recoverable.length ? await updateState('collections', previous => {
    const merged = [...(previous || [])];
    for (const collection of recoverable) {
      // A concurrent normal registration wins; never overwrite its metadata.
      if (!merged.some(item => item.path === collection.path)) merged.push({ ...collection, savedAt: Date.now() });
    }
    return merged;
  }) : collections;
  return summarizeCollections(repaired || [], tracks);
}

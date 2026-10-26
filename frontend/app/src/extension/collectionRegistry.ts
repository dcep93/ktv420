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
  const [collections, tracks] = await Promise.all([readState('collections'), listTracks()]);
  return summarizeCollections(collections || [], tracks);
}

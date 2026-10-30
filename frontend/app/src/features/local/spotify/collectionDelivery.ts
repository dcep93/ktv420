import { rememberCollection, savedCollection, type LibraryCollection } from '../collections';
import { spotifyRequest } from './client';

/** Small metadata handoff, independent of the potentially multi-GB audio queue. */
export async function receiveCollectionMetadata(request = spotifyRequest) {
  const failures: unknown[] = [];
  const collections = await request<(LibraryCollection & { handoffId: string })[]>('collections').catch(() => []);
  for (const collection of collections) {
    try {
      await rememberCollection(collection, collection.tracks);
      await request('ack-collection', { path: collection.path, requestId: collection.handoffId });
    } catch (error) { failures.push(error); }
  }
  return failures;
}

export async function loadPlaylistCollection(path: string, request = spotifyRequest) {
  try { return await savedCollection(path); }
  catch {
    await receiveCollectionMetadata(request);
    return savedCollection(path);
  }
}

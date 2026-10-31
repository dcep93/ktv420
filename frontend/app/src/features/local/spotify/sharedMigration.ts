import { SEPARATION_LOCK } from '../libraryClient';
import { libraryPublication } from '../libraryPublication';
import { receivePrepared } from './preparedDelivery';
import { receiveCollectionMetadata } from './collectionDelivery';
import { returnUnfinishedOriginals } from './returnOriginals';
import type { PreparedAudio } from '../../../shared/preparedAudio';
import type { QueuedCapture } from '../../../shared/captureFormat';
import { spotifyRequest } from './client';

/** Upgrade recovery only. New stems are never staged back into the extension. */
export async function migrateLegacyAudio(request = spotifyRequest) {
  await navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) return;
    const errors = await receiveCollectionMetadata(request);
    for (const prepared of await request<PreparedAudio[]>('prepared')) {
      try { await receivePrepared(prepared, request); } catch (error) { errors.push(error); }
    }
    // Older versions could leave an unfinished original only on the website.
    // Never duplicate a capture already in the transport/processing queue.
    const pending = await request<QueuedCapture[]>('work-pending');
    try { await returnUnfinishedOriginals(request, new Set(pending.map(c => `spotify-${c.metadata.trackId}`))); }
    catch (error) { errors.push(error); }
    if (errors.length) throw errors[0];
  });
}
export async function publishSharedLibrary(request = spotifyRequest) {
  const snapshot = await libraryPublication();
  await request('publish-library', snapshot);
}

import { receiveCapture } from './delivery';
import { getTrack, getInput, saveMp3, setTrackStatus, transaction } from '../library';
import { libraryPublication } from '../libraryPublication';
import { SEPARATION_LOCK } from '../libraryClient';
import { processLocalTrack } from '../processing';
import type { QueuedCapture } from '../../../shared/captureFormat';
import type { spotifyRequest } from './client';

/** The worker and every visible view use the same website database. */
export async function processSharedCapture(capture: QueuedCapture, token: string, request: typeof spotifyRequest,
  separator: Parameters<typeof processLocalTrack>[1], cancelled: () => boolean,
  report: Parameters<typeof processLocalTrack>[3], process = processLocalTrack) {
  return navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
    if (!lock || cancelled()) return;
    const id = `spotify-${capture.metadata.trackId}`, args = { id: capture.id, token };
    const deleted = await transaction<number | undefined>(['settings'], 'readonly', (tx, done) => {
      const r = tx.objectStore('settings').get(`deleted/${id}`); r.onsuccess = () => done(r.result);
    });
    if (deleted && capture.createdAt <= deleted) {
      await request('work-commit', { ...args, discarded: true }); return;
    }
    if ((await getTrack(id))?.status !== 'ready') {
      report({ phase: 'loading', fraction: 0, message: 'Saving captured audio…' });
      await receiveCapture(capture, async <T>(operation: string, value: Record<string, unknown> = {}): Promise<T> => {
        if (cancelled()) throw new Error('Separation paused.');
        // Retain the temporary capture until all stems have durably committed.
        if (operation === 'ack') return undefined as T;
        const chunk = await request<T>('work-chunk', { ...args, index: value.index });
        report({ phase: 'loading', fraction: (Number(value.index) + 1) / capture.nextChunk, message: 'Saving captured audio…' });
        return chunk;
      });
      if (cancelled()) return;
      await cacheArtwork(id, capture.metadata.trackArtworkSrc);
      await process(id, separator, cancelled, report, { getInput, saveMp3, setTrackStatus });
    }
    if ((await getTrack(id))?.status !== 'ready') return;
    // This also heals a crash after MP3 commit but before source acknowledgment.
    const snapshot = await libraryPublication();
    await request('work-commit', { ...args, ...snapshot });
  });
}
async function cacheArtwork(id: string, url: unknown) {
  if (typeof url !== 'string' || !/^https:\/\/[^/]*scdn\.co\//.test(url)) return;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: 'omit' });
    const blob = await response.blob();
    if (!response.ok || blob.size > 10 * 1024 ** 2 || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) return;
    await transaction(['tracks', 'audio'], 'readwrite', tx => {
      const r = tx.objectStore('tracks').get(id), prior = tx.objectStore('audio').get(`${id}/artwork`);
      prior.onsuccess = () => {
        if (!r.result) return;
        tx.objectStore('audio').put({ key: `${id}/artwork`, trackId: id, name: 'artwork', blob });
        tx.objectStore('tracks').put({ ...r.result, bytes: r.result.bytes - (prior.result?.blob.size || 0) + blob.size });
      };
    });
  } catch { /* Keep the URL; artwork failure must never discard a recording. */ }
}

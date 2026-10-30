import { queueTransaction, appendCapture, finishCapture } from './queue';
import { validateCapture, decodeChunk, type QueuedCapture } from '../shared/captureFormat';
import { parseCollection } from '../features/local/savedCollections';
/** Idempotent recovery of originals imported by older website versions. */
export function beginReturnedCapture(id: string, metadata: Record<string, unknown>, bytes: number): Promise<{ complete: boolean; nextChunk: number }> {
  validateCapture(metadata, bytes);
  const collection = parseCollection(metadata.collection);
  if (!collection?.trackIds.includes(String(metadata.trackId)) || JSON.stringify(metadata).length > 2 * 1024 * 1024) throw new Error('Invalid returned capture metadata.');
  return queueTransaction(['captures', 'prepared'], 'readwrite', (tx, done) => {
    const c = tx.objectStore('captures').get(id), p = tx.objectStore('prepared').get(id);
    p.onsuccess = () => {
      if (p.result) { done({ complete: true, nextChunk: 0 }); return; }
      if (c.result) {
        if (c.result.tabId !== -1 || c.result.expectedBytes !== bytes || JSON.stringify(c.result.metadata) !== JSON.stringify(metadata)) { tx.abort(); return; }
        done({ complete: c.result.complete, nextChunk: c.result.nextChunk }); return;
      }
      tx.objectStore('captures').add({ id, tabId: -1, metadata, expectedBytes: bytes, receivedBytes: 0, nextChunk: 0, createdAt: Date.now(), complete: false } satisfies QueuedCapture);
      done({ complete: false, nextChunk: 0 });
    };
  });
}
export function appendReturnedCapture(id: string, index: number, base64: string) {
  const bytes = decodeChunk(base64);
  if (bytes.length % 4) throw new Error('Misaligned returned audio.');
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length; i += 4) if (!Number.isFinite(view.getFloat32(i, true))) throw new Error('Non-finite returned audio.');
  return appendCapture(-1, id, index, base64);
}
export async function finishReturnedCapture(id: string) {
  const prepared = await queueTransaction<boolean>(['prepared'], 'readonly', (tx, done) => {
    const p = tx.objectStore('prepared').get(id); p.onsuccess = () => done(!!p.result);
  });
  if (!prepared) await finishCapture(-1, id);
}

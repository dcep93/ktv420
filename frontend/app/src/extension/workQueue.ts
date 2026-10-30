import { queueTransaction } from './queue';
import { LEASE_MS } from './staging';
import type { QueuedCapture } from '../shared/captureFormat';
export type WorkerOwner = `worker:${number}`;

/** A replacement document may reclaim its own old work, never another live tab's. */
export function recoverWorker(owner: WorkerOwner, documentId?: string) {
  return queueTransaction(['claims', 'uploads', 'chunks', 'captures', 'settings'], 'readwrite', tx => {
    if (documentId) tx.objectStore('settings').put(documentId, `worker-document/${owner}`);
    const captures = tx.objectStore('captures').openCursor();
    captures.onsuccess = () => {
      const capture = captures.result;
      if (!capture) return;
      const value = capture.value as QueuedCapture, retry = value.retryAfterReload;
      if (documentId && retry?.owner === owner && retry.documentId !== documentId) {
        delete value.processingError; delete value.retryAfterReload; capture.update(value);
      }
      capture.continue();
    };
    const cursor = tx.objectStore('claims').openCursor();
    cursor.onsuccess = () => {
      const claim = cursor.result;
      if (!claim) return;
      if (claim.value.owner === owner && (!documentId || claim.value.documentId !== documentId)) {
        const id = claim.value.id;
        claim.delete(); tx.objectStore('uploads').delete(id);
        const output = tx.objectStore('chunks').index('captureId').openCursor(`output/${id}`);
        output.onsuccess = () => { const part = output.result; if (part) { part.delete(); part.continue(); } };
      }
      claim.continue();
    };
  });
}
export function workState(): Promise<{ enabled: boolean; backend: 'auto' | 'wasm' }> {
  return queueTransaction(['settings'], 'readonly', (tx, done) => {
    const r = tx.objectStore('settings').get('processing'), backend = tx.objectStore('settings').get('backend');
    backend.onsuccess = () => done({ enabled: r.result !== false, backend: backend.result === 'wasm' ? 'wasm' : 'auto' });
  });
}
export function configureWork(enabled: boolean, retry = false, backend?: 'auto' | 'wasm') {
  return queueTransaction(['settings', 'captures'], 'readwrite', tx => {
    tx.objectStore('settings').put(enabled, 'processing');
    if (backend) tx.objectStore('settings').put(backend, 'backend');
    if (retry) {
      const r = tx.objectStore('captures').openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { const value = c.value; delete value.processingError; delete value.retryAfterReload; c.update(value); c.continue(); } };
    }
  });
}
/** One inference slot for all overlays and website tabs, claimed atomically. */
export function claimWork(id: string, owner: WorkerOwner, documentId?: string): Promise<string | null> {
  return queueTransaction(['captures', 'claims', 'settings'], 'readwrite', (tx, done) => {
    const capture = tx.objectStore('captures').get(id), enabled = tx.objectStore('settings').get('processing'), currentDocument = tx.objectStore('settings').get(`worker-document/${owner}`), claims = tx.objectStore('claims').getAll();
    claims.onsuccess = () => {
      const c = capture.result as QueuedCapture | undefined;
      if (!c?.complete || c.processingError || enabled.result === false || (documentId && currentDocument.result && currentDocument.result !== documentId) || claims.result.some(l => l.expires > Date.now() &&
          (l.id === id || l.owner !== 'website'))) { done(null); return; }
      const token = crypto.randomUUID();
      tx.objectStore('claims').put({ id, token, owner, documentId, expires: Date.now() + LEASE_MS }); done(token);
    };
  });
}
export function failWork(id: string, token: string, owner: WorkerOwner, error: string, recoverOnReload = false) {
  return queueTransaction(['captures', 'claims'], 'readwrite', tx => {
    const c = tx.objectStore('captures').get(id), claim = tx.objectStore('claims').get(id);
    claim.onsuccess = () => {
      if (claim.result?.token !== token || claim.result.owner !== owner || claim.result.expires <= Date.now()) { tx.abort(); return; }
      if (c.result) tx.objectStore('captures').put({ ...c.result, processingError: error,
        retryAfterReload: recoverOnReload && claim.result.documentId ? { owner, documentId: claim.result.documentId } : undefined });
    };
  });
}

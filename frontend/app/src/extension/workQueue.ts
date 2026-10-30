import { queueTransaction } from './queue';
import { LEASE_MS } from './staging';
import type { QueuedCapture } from '../shared/captureFormat';
export type WorkerOwner = `worker:${number}`;
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
      r.onsuccess = () => { const c = r.result; if (c) { const value = c.value; delete value.processingError; c.update(value); c.continue(); } };
    }
  });
}
/** One inference slot for all overlays and website tabs, claimed atomically. */
export function claimWork(id: string, owner: WorkerOwner): Promise<string | null> {
  return queueTransaction(['captures', 'claims', 'settings'], 'readwrite', (tx, done) => {
    const capture = tx.objectStore('captures').get(id), enabled = tx.objectStore('settings').get('processing'), claims = tx.objectStore('claims').getAll();
    claims.onsuccess = () => {
      const c = capture.result as QueuedCapture | undefined;
      if (!c?.complete || c.processingError || enabled.result === false || claims.result.some(l => l.expires > Date.now() &&
          (l.id === id || l.owner !== 'website'))) { done(null); return; }
      const token = crypto.randomUUID();
      tx.objectStore('claims').put({ id, token, owner, expires: Date.now() + LEASE_MS }); done(token);
    };
  });
}
export function failWork(id: string, token: string, owner: WorkerOwner, error: string) {
  return queueTransaction(['captures', 'claims'], 'readwrite', tx => {
    const c = tx.objectStore('captures').get(id), claim = tx.objectStore('claims').get(id);
    claim.onsuccess = () => {
      if (claim.result?.token !== token || claim.result.owner !== owner || claim.result.expires <= Date.now()) { tx.abort(); return; }
      if (c.result) tx.objectStore('captures').put({ ...c.result, processingError: error });
    };
  });
}

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { queueTransaction } from './queue';
let present = false, created = 0, closed = 0;
globalThis.chrome = {
  runtime: { ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getURL: (path: string) => `chrome-extension://test/${path}`,
    getContexts: async () => present ? [{}] : [] },
  tabs: { query: async () => [] },
  offscreen: { closeDocument: async () => { closed++; present = false; }, Reason: { WORKERS: 'WORKERS' }, createDocument: async () => { created++; await new Promise(resolve => setImmediate(resolve)); present = true; } },
} as unknown as typeof chrome;
const { ensureWorkerHost } = await import('./workerHost');
test('concurrent view opens create exactly one worker; further opens retain it; a missing document is recreated', async () => {
  await Promise.all([ensureWorkerHost(), ensureWorkerHost(), ensureWorkerHost()]); assert.equal(created, 1);
  await ensureWorkerHost(); assert.equal(created, 1);
  present = false;
  await Promise.all([ensureWorkerHost(), ensureWorkerHost()]); assert.equal(created, 2);
});

test('page entry preserves a healthy host but replaces stalled inference in an existing host', async () => {
  const id = crypto.randomUUID(), now = Date.now();
  const claim = { id, token: crypto.randomUUID(), owner: 'worker:background', expires: now + 120000, progressUpdatedAt: now, progress: { fraction: .2, message: 'Running GPU model' } };
  await queueTransaction(['claims', 'captures'], 'readwrite', tx => { tx.objectStore('claims').put(claim); tx.objectStore('captures').put({ id, complete: true }); });
  const count = created;
  await ensureWorkerHost(true); assert.equal(created, count); assert.equal(closed, 0);
  await queueTransaction(['claims'], 'readwrite', tx => { tx.objectStore('claims').put({ ...claim, progressUpdatedAt: now - 100000 }); });
  await Promise.all([ensureWorkerHost(), ensureWorkerHost(true)]);
  assert.equal(created, count + 1); assert.equal(closed, 1);
});

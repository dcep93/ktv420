import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
let present = false, created = 0;
globalThis.chrome = {
  runtime: { ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getURL: (path: string) => `chrome-extension://test/${path}`,
    getContexts: async () => present ? [{}] : [] },
  tabs: { query: async () => [] },
  offscreen: { Reason: { WORKERS: 'WORKERS' }, createDocument: async () => { created++; await new Promise(resolve => setImmediate(resolve)); present = true; } },
} as unknown as typeof chrome;
const { ensureWorkerHost } = await import('./workerHost');
test('concurrent view opens create exactly one worker; further opens retain it; a missing document is recreated', async () => {
  await Promise.all([ensureWorkerHost(), ensureWorkerHost(), ensureWorkerHost()]); assert.equal(created, 1);
  await ensureWorkerHost(); assert.equal(created, 1);
  present = false;
  await Promise.all([ensureWorkerHost(), ensureWorkerHost()]); assert.equal(created, 2);
});

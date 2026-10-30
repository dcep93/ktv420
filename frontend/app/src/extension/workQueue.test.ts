import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queueTransaction, beginCapture, appendCapture, finishCapture, pendingCaptures } from './queue';
import { claimWork, configureWork, workState, failWork } from './workQueue';
import { releaseClaim, touchClaim } from './staging';
beforeEach(async () => { await queueTransaction(['captures', 'chunks', 'claims', 'settings'], 'readwrite', tx => {
  for (const name of ['captures', 'chunks', 'claims', 'settings']) tx.objectStore(name).clear();
}); });
async function recording(tabId: number) {
  const metadata = { trackId: `song${tabId}`, audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: 16, captureStartVerified: true, captureEndVerified: true };
  const id = await beginCapture(tabId, metadata, 16); await appendCapture(tabId, id, 0, btoa('\0'.repeat(16))); await finishCapture(tabId, id); return id;
}
test('all views share one inference slot; closing or crashing permits takeover without losing raw audio', async () => {
  const first = await recording(1), second = await recording(2);
  const token = await claimWork(first, 'worker:20'); assert.ok(token); // website, not original Spotify tab
  assert.equal(await claimWork(first, 'worker:1'), null);
  assert.equal(await claimWork(second, 'worker:1'), null);
  await assert.rejects(touchClaim(first, token, 'worker:1'));
  await releaseClaim(first, token, 'worker:20');
  const takeover = await claimWork(first, 'worker:1'); assert.ok(takeover);
  await queueTransaction(['claims'], 'readwrite', tx => tx.objectStore('claims').put({ id: first, token: takeover, owner: 'worker:1', expires: 0 }));
  assert.ok(await claimWork(second, 'worker:30'));
  assert.equal((await pendingCaptures()).length, 2);
});
test('pause applies across views and failed songs require explicit retry', async () => {
  const id = await recording(1);
  await configureWork(false); assert.deepEqual(await workState(), { enabled: false, backend: 'auto' });
  assert.equal(await claimWork(id, 'worker:1'), null);
  await configureWork(true);
  const token = await claimWork(id, 'worker:2'); assert.ok(token);
  await failWork(id, token, 'worker:2', 'GPU unavailable'); await releaseClaim(id, token, 'worker:2');
  assert.equal((await pendingCaptures())[0].processingError, 'GPU unavailable');
  assert.equal(await claimWork(id, 'worker:1'), null);
  await configureWork(true, true); assert.ok(await claimWork(id, 'worker:1'));
});
test('device selection and pause are durable and validated at the protocol boundary', async () => {
  const { parseRequest } = await import('./protocol');
  await configureWork(true, false, 'wasm');
  await configureWork(false);
  assert.deepEqual(await workState(), { enabled: false, backend: 'wasm' });
  const request = { protocol: 'ktv420-spotify', version: 1, operation: 'work-config', enabled: true };
  assert.throws(() => parseRequest({ ...request, enabled: 'yes' }), /Invalid queue preference/);
  assert.throws(() => parseRequest({ ...request, backend: 'remote' }), /Invalid separation device/);
  assert.throws(() => parseRequest({ ...request, operation: 'return-chunk', id: crypto.randomUUID(), index: -1, base64: 'AAAA' }), /Invalid returned chunk/);
});

import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queueTransaction, beginCapture, appendCapture, finishCapture, pendingCaptures } from './queue';
import { claimWork, configureWork, workState, failWork, recoverWorker } from './workQueue';
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

test('reload immediately reclaims an old document, preserves input, and rejects late old work', async () => {
  const id = await recording(1);
  const old = await claimWork(id, 'worker:1', 'old-document'); assert.ok(old);
  await touchClaim(id, old, 'worker:1', { fraction: .15, message: 'Old progress' });
  await queueTransaction(['uploads', 'chunks'], 'readwrite', tx => {
    tx.objectStore('uploads').put({ id, token: old });
    tx.objectStore('chunks').put({ key: `output/${id}/input/0`, captureId: `output/${id}`, blob: new Blob(['partial']) });
  });
  await recoverWorker('worker:1', 'replacement-document');
  assert.equal((await pendingCaptures()).length, 1);
  await queueTransaction(['chunks', 'uploads'], 'readonly', (tx, done) => {
    const input = tx.objectStore('chunks').index('captureId').getAll(id);
    const output = tx.objectStore('chunks').index('captureId').getAll(`output/${id}`);
    const upload = tx.objectStore('uploads').get(id);
    upload.onsuccess = () => { assert.equal(input.result.length, 1); assert.equal(output.result.length, 0); assert.equal(upload.result, undefined); done(undefined); };
  });
  assert.equal(await claimWork(id, 'worker:1', 'old-document'), null);
  const next = await claimWork(id, 'worker:1', 'replacement-document'); assert.ok(next);
  await assert.rejects(touchClaim(id, old, 'worker:1'));
  await recoverWorker('worker:1', 'replacement-document');
  await touchClaim(id, next, 'worker:1'); // repeated startup is idempotent
});

test('loading another tab cannot steal active separation; pause survives reload', async () => {
  const id = await recording(1);
  const token = await claimWork(id, 'worker:9', 'live-document'); assert.ok(token);
  await recoverWorker('worker:1', 'new-document');
  assert.equal(await claimWork(id, 'worker:1', 'new-document'), null);
  await touchClaim(id, token, 'worker:9');
  await configureWork(false);
  await recoverWorker('worker:9', 'replacement-document');
  assert.equal(await claimWork(id, 'worker:9', 'replacement-document'), null);
  assert.equal((await workState()).enabled, false);
});

test('reload retries interrupted workers once per document, but retains genuine errors', async () => {
  const id = await recording(1);
  const token = await claimWork(id, 'worker:1', 'old'); assert.ok(token);
  await failWork(id, token, 'worker:1', 'Worker stopped responding', true);
  await releaseClaim(id, token, 'worker:1');
  await recoverWorker('worker:1', 'old');
  assert.equal(await claimWork(id, 'worker:1', 'old'), null);
  await recoverWorker('worker:2', 'other-tab');
  assert.equal((await pendingCaptures())[0].processingError, 'Worker stopped responding');
  await recoverWorker('worker:1', 'new');
  const next = await claimWork(id, 'worker:1', 'new'); assert.ok(next);
  await failWork(id, next, 'worker:1', 'Invalid recording');
  await releaseClaim(id, next, 'worker:1');
  await recoverWorker('worker:1', 'newer');
  assert.equal((await pendingCaptures())[0].processingError, 'Invalid recording');
});

test('background owner survives UI closure and replaces an interrupted worker session immediately', async () => {
  const id = await recording(1);
  await recoverWorker('worker:background', 'session-a');
  const token = await claimWork(id, 'worker:background', 'session-a'); assert.ok(token);
  const { recoverQueue } = await import('./queueRecovery');
  await recoverQueue(new Set()); // all visible tabs closed
  await touchClaim(id, token, 'worker:background');
  await recoverWorker('worker:background', 'session-b');
  await assert.rejects(touchClaim(id, token, 'worker:background'));
  assert.equal(await claimWork(id, 'worker:background', 'session-a'), null);
  assert.ok(await claimWork(id, 'worker:background', 'session-b'));
  assert.equal((await pendingCaptures()).length, 1);
});
test('transient failures back off, retry within the same session, and eventually stop instead of looping', async () => {
  const id = await recording(1);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const token = await claimWork(id, 'worker:background', 'session'); assert.ok(token);
    await failWork(id, token, 'worker:background', 'Connection interrupted', false, true);
    await releaseClaim(id, token, 'worker:background');
    assert.equal(await claimWork(id, 'worker:background', 'session'), null);
    const c = (await pendingCaptures())[0]; assert.equal(c.attempts, attempt);
    if (attempt < 4) { assert.ok(c.retryAt! > Date.now()); await queueTransaction(['captures'], 'readwrite', tx => tx.objectStore('captures').put({ ...c, retryAt: Date.now() - 1 })); }
    else assert.equal(c.retryAt, undefined);
  }
});
test('recovery removes incomplete transfers from gone tabs, preserving live transfers and every complete recording', async () => {
  const done = await recording(1);
  const metadata = { ...(await pendingCaptures())[0].metadata };
  const orphan = await beginCapture(2, metadata, 16), live = await beginCapture(3, metadata, 16);
  await appendCapture(2, orphan, 0, btoa('\0'.repeat(16)));
  const { recoverQueue } = await import('./queueRecovery'); await recoverQueue(new Set([3]));
  await queueTransaction(['captures', 'chunks'], 'readonly', (tx, finish) => {
    const a = tx.objectStore('captures').getAll(), b = tx.objectStore('chunks').index('captureId').getAll(orphan);
    b.onsuccess = () => { assert.deepEqual(new Set(a.result.map(c => c.id)), new Set([done, live])); assert.equal(b.result.length, 0); finish(undefined); };
  });
});

test('same-tab refresh removes abandoned upload chunks but never completed recordings', async () => {
  const done = await recording(1), metadata = (await pendingCaptures())[0].metadata;
  const incomplete = await beginCapture(1, metadata, 16, 'old-document');
  await appendCapture(1, incomplete, 0, btoa('\0'.repeat(16)));
  const { recoverCaptureDocument } = await import('./queueRecovery');
  await recoverCaptureDocument(1, 'new-document');
  assert.deepEqual((await pendingCaptures()).map(c => c.id), [done]);
  await assert.rejects(finishCapture(1, incomplete));
});

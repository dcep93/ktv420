import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { stalledClaim, recoverStalledWork } from './workerHealth';
import { queueTransaction } from './queue';
import { touchClaim } from './staging';

test('reconnecting preserves recent progress and adapts to slow CPU steps', () => {
  const claim = { id: 'job', token: 'token', owner: 'worker:background', expires: 1e7, progressUpdatedAt: 0, progress: { fraction: .1, message: 'Running GPU model' } };
  assert.equal(stalledClaim(claim, 89000), false);
  assert.equal(stalledClaim(claim, 91000), true);
  assert.equal(stalledClaim({ ...claim, slowestStepMs: 60000 }, 200000), false);
  assert.equal(stalledClaim({ ...claim, progress: { ...claim.progress, message: 'Running CPU model' } }, 100000), false);
  assert.equal(stalledClaim({ ...claim, owner: 'website' }, 1e8), false);
});
test('heartbeat text cannot disguise a stalled job; reopening invalidates it without deleting its original', async () => {
  const now = Date.now(), id = crypto.randomUUID(), token = crypto.randomUUID();
  await queueTransaction(['claims', 'captures'], 'readwrite', tx => {
    tx.objectStore('captures').put({ id, complete: true, receivedBytes: 16 });
    tx.objectStore('claims').put({ id, token, owner: 'worker:background', expires: now + 120000, progressUpdatedAt: now - 100000, progress: { fraction: .2, message: 'Running GPU model' } });
  });
  await touchClaim(id, token, 'worker:background', { fraction: .2, message: 'Running GPU model · no new progress for 100s' });
  assert.equal(await recoverStalledWork(now), true);
  const data = await queueTransaction<{ claim: unknown; capture: { complete: boolean; recoveries: number } }>(['claims', 'captures'], 'readonly', (tx, done) => {
    const c = tx.objectStore('claims').get(id), raw = tx.objectStore('captures').get(id); raw.onsuccess = () => done({ claim: c.result, capture: raw.result });
  });
  assert.equal(data.claim, undefined); assert.equal(data.capture.complete, true); assert.equal(data.capture.recoveries, 1);
  assert.equal(await recoverStalledWork(now), false);
});

test('repeated stalled restarts stop at an actionable error until explicit retry', async () => {
  const { recoverWorker, configureWork } = await import('./workQueue');
  const id = crypto.randomUUID(), now = Date.now();
  await queueTransaction(['claims', 'captures'], 'readwrite', tx => {
    tx.objectStore('captures').put({ id, complete: true, recoveries: 3, retryAfterReload: { owner: 'worker:background', documentId: 'old' } });
    tx.objectStore('claims').put({ id, owner: 'worker:background', token: 'token', expires: now - 1 });
  });
  await recoverStalledWork(now); await recoverWorker('worker:background', 'new');
  const read = () => queueTransaction<{ processingError?: string; recoveries: number }>(['captures'], 'readonly', (tx, done) => { const r = tx.objectStore('captures').get(id); r.onsuccess = () => done(r.result); });
  assert.match((await read()).processingError!, /CPU compatibility/);
  await configureWork(true, true);
  assert.equal((await read()).processingError, undefined); assert.equal((await read()).recoveries, 0);
});

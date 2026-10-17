import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState, updateState } from './state';
import { claimListeningLease } from './listeningLease';

test('coordination persists across connections and serializes competing claims without Chrome storage', async () => {
  await updateState('listeningLease', () => undefined);
  const leases = await Promise.all([1, 2].map(tab => updateState('listeningLease', previous => claimListeningLease(previous, tab, 100))));
  assert.deepEqual(leases, [{ tabId: 1, expires: 3100 }, { tabId: 1, expires: 3100 }]);
  assert.deepEqual(await readState('listeningLease'), leases[0]);
  assert.deepEqual(await updateState('listeningLease', previous => claimListeningLease(previous, 2, 3101)), { tabId: 2, expires: 6101 });
  await assert.rejects(updateState('listeningLease', () => { throw new Error('interrupted'); }), /interrupted/);
  assert.deepEqual(await readState('listeningLease'), { tabId: 2, expires: 6101 });
  await updateState('listeningLease', () => undefined);
  assert.equal(await readState('listeningLease'), undefined);
});

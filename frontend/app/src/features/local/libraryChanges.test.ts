import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transaction, getTrack } from './library';
import { libraryChanges } from './libraryChanges';
import { missingTrackLabel } from './missingTrackLabel';

test('track commit notifies readers immediately, with saved data already readable', async () => {
  const id = crypto.randomUUID();
  let refresh: ReturnType<typeof getTrack> | undefined;
  const update = () => { refresh = getTrack(id); };
  libraryChanges.addEventListener('change', update);
  try {
    await transaction(['tracks'], 'readwrite', tx => tx.objectStore('tracks').put({ id, status: 'ready' }));
    assert.ok(refresh, 'refresh starts before the importer acknowledges/removes extension stems');
    assert.equal((await refresh)?.status, 'ready');
    refresh = undefined;
    await transaction(['tracks'], 'readonly', tx => { tx.objectStore('tracks').get(id); });
    assert.equal(refresh, undefined, 'refresh reads do not cause a notification loop');
    await assert.rejects(transaction(['tracks'], 'readwrite', tx => { tx.objectStore('tracks').delete(id); tx.abort(); }));
    assert.equal(refresh, undefined, 'aborted changes do not notify');
  } finally { libraryChanges.removeEventListener('change', update); }
});

test('playlist handoff never calls a known imported track not captured', () => {
  assert.equal(missingTrackLabel(false, false), 'Loading…');
  assert.equal(missingTrackLabel(true, false), 'Loading…');
  // Extension acknowledgment has removed staging, but the local UI snapshot is still old.
  assert.equal(missingTrackLabel(true, true, { id: 'spotify-test', status: 'ready', location: 'website' }), 'Loading saved stems…');
  assert.equal(missingTrackLabel(true, true), 'Not captured');
});

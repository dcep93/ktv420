import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, getTrack } from './library';
import { libraryPublication } from './libraryPublication';
import { rememberCollection, deleteCollectionAudio, listCollections } from './collections';
import { MP3_NAMES } from './audio/mp3Types';
const a = 'album/aaaaaaaaaaaaaaaaaaaaaa', b = 'album/bbbbbbbbbbbbbbbbbbbbbb';
Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, fn: (lock: object) => unknown) => fn({}) } });
test('website readiness requires all saved audio, and publication revisions cannot run backwards across views', async () => {
  await transaction(['tracks', 'audio'], 'readwrite', tx => {
    for (const id of ['spotify-good', 'spotify-missing']) tx.objectStore('tracks').put({ id, source: 'spotify', status: 'ready' });
    for (const name of MP3_NAMES) tx.objectStore('audio').put({ key: `spotify-good/${name}.mp3`, trackId: 'spotify-good', name: `${name}.mp3`, blob: new Blob(['audio']) });
  });
  const first = await libraryPublication(), second = await libraryPublication();
  assert.deepEqual(first.tracks.map(t => t.id), ['spotify-good']); assert.ok(second.revision > first.revision);
});
test('deleting a collection retains songs used by other collections and rejects stale metadata resurrection', async () => {
  await rememberCollection({ path: a, title: 'A', artwork: '', trackIds: ['shared', 'onlyA'], observedAt: 1 });
  await rememberCollection({ path: b, title: 'B', artwork: '', trackIds: ['shared'], observedAt: 1 });
  await transaction(['tracks'], 'readwrite', tx => { for (const id of ['shared', 'onlyA']) tx.objectStore('tracks').put({ id: `spotify-${id}`, source: 'spotify', status: 'ready' }); });
  await deleteCollectionAudio(a);
  assert.ok(await getTrack('spotify-shared')); assert.equal(await getTrack('spotify-onlyA'), undefined);
  await rememberCollection({ path: a, title: 'Old A', artwork: '', trackIds: ['shared', 'onlyA'], observedAt: 1 });
  assert.equal((await listCollections()).some(c => c.path === a), false);
});

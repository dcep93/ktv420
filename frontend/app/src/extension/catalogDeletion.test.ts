import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteCollectionAudio } from './catalogDeletion';
import { rememberCollection, savedCollections } from './collectionRegistry';
import { readState, updateState } from './state';
import { saveInput, getTrack, getPlaybackRecord, transaction } from '../features/local/library';
import { SEPARATION_LOCK, type BrokerLocks } from './libraryBroker';

const album = { path:'album/1111111111111111111111', title:'Album', artwork:'', trackIds:['shared','onlyAlbum'] };
const playlist = { path:'playlist/2222222222222222222222', title:'Playlist', artwork:'', trackIds:['shared','onlyPlaylist'] };
const locks = (available: boolean) => ({ request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
  assert.equal(name, SEPARATION_LOCK); assert.equal(options.ifAvailable, true);
  return callback(available ? { name, mode:'exclusive' } : null);
} }) as BrokerLocks;

test('catalog deletion is scoped, guarded, removes all audio, and keeps collection links', async () => {
  await updateState('collections', () => undefined);
  await updateState('listeningLease', () => undefined);
  for (const id of ['shared','onlyAlbum','onlyPlaylist']) {
    await saveInput({ id:`spotify-${id}`, title:id, artist:'', createdAt:1, sampleRate:44100, frames:1, status:'captured', bytes:0, source:'spotify' }, new Blob(['original']));
    await transaction(['audio'], 'readwrite', tx => tx.objectStore('audio').put({key:`spotify-${id}/vocals.mp3`,trackId:`spotify-${id}`,name:'vocals.mp3',blob:new Blob(['stem'])}));
  }
  await rememberCollection(album); await rememberCollection(playlist);
  for (const path of [undefined, '../audio', 'album/3333333333333333333333']) await assert.rejects(deleteCollectionAudio(path, locks(true)));
  await assert.rejects(deleteCollectionAudio(album.path, locks(false)), /Pause separation/);
  await updateState('listeningLease', () => ({tabId:42,expires:Date.now()+3000}));
  await assert.rejects(deleteCollectionAudio(album.path, locks(true)), /Close the ktv420 overlay/);
  assert.ok(await getTrack('spotify-shared'));
  assert.ok(await getTrack('spotify-onlyAlbum'));
  await updateState('listeningLease', () => undefined);
  await deleteCollectionAudio(album.path, locks(true));
  for (const id of album.trackIds) {
    assert.equal(await getTrack(`spotify-${id}`), undefined);
    assert.deepEqual((await getPlaybackRecord(`spotify-${id}`)).files, []);
  }
  assert.ok(await getTrack('spotify-onlyPlaylist'));
  const catalog = await savedCollections();
  assert.equal(catalog.find(item => item.path === album.path)?.captured, 0);
  assert.equal(catalog.find(item => item.path === playlist.path)?.captured, 1);
  assert.equal(await readState('listeningLease'), undefined, 'deletion releases playback ownership');
});

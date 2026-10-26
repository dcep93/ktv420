import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedCollections, rememberCollection, setCaptureContext } from './collectionRegistry';
import { readState, updateState } from './state';
import { saveInput, setTrackStatus, deleteTrack } from '../features/local/library';
import { parseCollection, collectionLink } from '../features/local/savedCollections';
const collection = {path:'album/3l2Gi0hMjZV2uvKoWlFkoQ', title:'A saved album', artwork:'https://i.scdn.co/image/cover', trackIds:['one','two']};
test('registry validates paths, metadata and sender; never exposes arbitrary links', async () => {
  for (const patch of [{path:'../saved'}, {path:'track/3l2Gi0hMjZV2uvKoWlFkoQ'}, {trackIds:[null]}, {title:4}, {trackIds:[]}]) assert.equal(parseCollection({...collection,...patch}), null);
  assert.equal(parseCollection({...collection,artwork:'https://evil.example/image'})?.artwork, '');
  assert.equal(collectionLink(collection.path), 'https://open.spotify.com/album/3l2Gi0hMjZV2uvKoWlFkoQ?ktv420');
  await assert.rejects(setCaptureContext(1,collection,'https://open.spotify.com/playlist/1111111111111111111111'));
});
test('saved registry persists, deduplicates, backfills, reports current readiness and hides deleted audio', async () => {
  await updateState('collections', () => undefined);
  await setCaptureContext(5,collection,collectionLink(collection.path));
  assert.deepEqual(await savedCollections(), [], 'visiting alone does not register a saved collection');
  assert.deepEqual((await readState('captureContexts'))?.[5], collection);
  await saveInput({id:'spotify-one',title:'One',artist:'',createdAt:1,sampleRate:44100,frames:1,status:'captured',bytes:0,source:'spotify'},new Blob(['audio']));
  await rememberCollection(collection);
  const first = (await savedCollections())[0];
  assert.equal(first.captured, 1); assert.equal(first.ready, 0); assert.equal(first.total, 2);
  await rememberCollection({...collection,title:'',artwork:''});
  assert.equal((await savedCollections()).length,1);
  assert.equal((await savedCollections())[0].title,collection.title);
  assert.equal((await savedCollections())[0].savedAt,first.savedAt);
  await setTrackStatus('spotify-one','ready');
  assert.equal((await savedCollections())[0].ready,1);
  await deleteTrack('spotify-one');
  assert.deepEqual(await savedCollections(),[]);
});

test('capture start appears before audio exists and remains visible through partial saves and reloads', async () => {
  await updateState('collections', () => undefined);
  await setCaptureContext(6, collection, collectionLink(collection.path), true);
  const started = (await savedCollections())[0];
  assert.equal(started.captured, 0); assert.equal(started.ready, 0); assert.equal(started.total, 2);
  assert.ok(started.startedAt);
  await setCaptureContext(6, {...collection, title:''}, collectionLink(collection.path));
  assert.deepEqual((await savedCollections())[0], started, 'ordinary refresh preserves the started entry');
  await saveInput({id:'spotify-two',title:'Two',artist:'',createdAt:1,sampleRate:44100,frames:1,status:'captured',bytes:0,source:'spotify'},new Blob(['audio']));
  assert.equal((await savedCollections())[0].captured, 1);
  await setTrackStatus('spotify-two', 'ready');
  assert.equal((await savedCollections())[0].ready, 1);
  await deleteTrack('spotify-two');
  assert.equal((await savedCollections())[0].captured, 0, 'started collection remains available for recapture');
  assert.equal((await savedCollections()).length, 1);
});

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

test('catalog repairs absent registry entries from matching saved audio and persisted contexts', async () => {
  await updateState('collections', () => undefined);
  const missing = {...collection,path:'album/3WZZF72ihlKPZBS4zSsNHl',title:'Recovered album',trackIds:['recovered','uncaptured']};
  const visited = {...collection,path:'album/2222222222222222222222',trackIds:['never-captured']};
  await updateState('captureContexts', () => ({8:missing,9:visited,10:missing,11:{...missing,path:'invalid'}}));
  await saveInput({id:'spotify-recovered',title:'Recovered song',artist:'',createdAt:1,sampleRate:44100,frames:1,status:'captured',bytes:0,source:'spotify'},new Blob(['audio']));
  const repaired = await savedCollections();
  assert.equal(repaired.length, 1, 'duplicate contexts, invalid paths and visits without audio are excluded');
  assert.equal(repaired[0].path, missing.path); assert.equal(repaired[0].title, missing.title);
  assert.equal(repaired[0].captured, 1); assert.equal(repaired[0].total, 2);
  assert.deepEqual(await savedCollections(), repaired, 'repeated reads are idempotent');
  await updateState('captureContexts', () => undefined);
  await setTrackStatus('spotify-recovered','ready');
  assert.deepEqual(await savedCollections(), [{...repaired[0],ready:1}], 'recovery persists after old tab contexts are evicted');
  await deleteTrack('spotify-recovered');
});

test('standalone collection keeps registry order and missing rows, and includes saved names', async () => {
  const { savedCollection } = await import('./collectionRegistry');
  await updateState('collections', () => [{...collection, trackIds:['two','missing','one'],savedAt:1,startedAt:1}]);
  await saveInput({id:'spotify-two',title:'Second title',artist:'Artist',createdAt:1,sampleRate:44100,frames:1,status:'captured',bytes:0,source:'spotify'},new Blob(['audio']));
  const detail=await savedCollection(collection.path);
  assert.deepEqual(detail.tracks.map(row=>row.trackId),['two','missing','one']);
  assert.equal(detail.tracks[0].trackName,'Second title'); assert.equal(detail.tracks[0].trackArtist,'Artist');
  assert.equal(detail.tracks[1].rowIndex,1); assert.equal(detail.tracks[1].trackName,'Track 2');
  assert.equal('files' in detail,false);
  await assert.rejects(savedCollection('album/invalid'),/Invalid playlist/);
  await assert.rejects(savedCollection('album/9999999999999999999999'),/not in/);
  await deleteTrack('spotify-two');
});

test('complete playlist replaces historical IDs and order without deleting old audio', async () => {
  await updateState('collections', () => [{...collection, trackIds:['oldVersion','two','one'],savedAt:1,startedAt:1}]);
  await saveInput({id:'spotify-oldVersion',title:'Old version',artist:'',createdAt:1,sampleRate:44100,frames:1,status:'captured',bytes:0,source:'spotify'},new Blob(['audio']));
  await rememberCollection({...collection,trackIds:['one','newVersion','two'],complete:true});
  const saved=(await readState('collections'))?.[0];
  assert.deepEqual(saved?.trackIds,['one','newVersion','two']);
  assert.equal(saved?.savedAt,1);
  assert.equal((await savedCollections())[0].total,3);
  const {listTracks}=await import('../features/local/library');
  assert.ok((await listTracks()).some(track=>track.id==='spotify-oldVersion'));
  await rememberCollection({...collection,trackIds:['oldVersion']});
  assert.deepEqual((await readState('collections'))?.[0].trackIds,['one','newVersion','two'],'partial older tabs must not reintroduce stale IDs');
  await rememberCollection({...collection,trackIds:['two','two','one'],complete:true});
  assert.deepEqual((await readState('collections'))?.[0].trackIds,['two','one'],'repeated songs still share one stored audio entry');
  await deleteTrack('spotify-oldVersion');
});

test('partial discovery can grow a legacy catalog but cannot remove unseen members', async () => {
  await updateState('collections', () => [{...collection,savedAt:1,startedAt:1}]);
  await rememberCollection({...collection,trackIds:['two','three']});
  assert.deepEqual((await readState('collections'))?.[0].trackIds,['one','two','three']);
});

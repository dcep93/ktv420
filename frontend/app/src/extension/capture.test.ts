import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginCapture, appendCapture, finishCapture } from './capture.ts';
import { getInput, getTrack, deleteTrack, transaction } from '../features/local/library.ts';
import { decodeWav } from '../features/local/audio/wav.ts';
const samples = new Float32Array([-0,1.25,-1.25,0.00000001,0.5,-0.5]);
const bytes = new Uint8Array(samples.buffer);
const meta = {trackId:'testCapture',trackName:'fixture',trackArtist:'fixture artist',audioSampleRate:48000,audioChannelCount:2,audioSampleFormat:'PCM_F32LE',audioByteLength:bytes.length};
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64');
test('capture retains Float32 channel words and commits only after all chunks arrive', async () => {
  const id = await beginCapture(1,meta,bytes.length);
  await appendCapture(1,id,0,b64(bytes.subarray(0,8)));
  await assert.rejects(finishCapture(1,id));
  assert.equal(await getTrack('spotify-testCapture'),undefined);
  await assert.rejects(appendCapture(2,id,1,b64(bytes.subarray(8))));
  await assert.rejects(appendCapture(1,id,2,b64(bytes.subarray(8))));
  await appendCapture(1,id,1,b64(bytes.subarray(8)));
  await finishCapture(1,id);
  const saved = await getTrack('spotify-testCapture');
  assert.equal(saved?.title, 'fixture'); assert.equal(saved?.artist, 'fixture artist');
  const audio = decodeWav(await (await getInput('spotify-testCapture')).arrayBuffer());
  assert.equal(audio.sampleRate,48000);
  assert.deepEqual([...audio.left],[-0,-1.25,0.5]);
  assert.deepEqual([...audio.right],[1.25,samples[3],-0.5]);
  await deleteTrack('spotify-testCapture');
});
test('capture rejects formats, mismatched byte counts and channel layouts', async () => {
  await assert.rejects(beginCapture(1,{...meta,audioSampleFormat:'PCM_S16LE'},bytes.length));
  await assert.rejects(beginCapture(1,meta,bytes.length+4));
  await assert.rejects(beginCapture(1,{...meta,audioChannelCount:3},bytes.length));
  for (const trackId of [undefined, null, 123]) await assert.rejects(beginCapture(1,{...meta,trackId},bytes.length));
});

test('starting a replacement capture never sweeps up its new session', async () => {
 await transaction(['captures'],'readwrite',tx=>tx.objectStore('captures').put({id:'00000000',tabId:5,createdAt:1}));
 const id=await beginCapture(5,meta,bytes.length);
 await appendCapture(5,id,0,b64(bytes));
 await finishCapture(5,id);
 assert.equal((await getTrack('spotify-testCapture'))?.status,'captured');
 await deleteTrack('spotify-testCapture');
});

// Only capture metadata is staged: no GiB-sized allocation is needed for these boundaries.
test('capture accepts the exact 1 GiB boundary and rejects one frame above it', async () => {
 const limit=1024**3;
 await beginCapture(999,{...meta,audioByteLength:limit},limit);
 await assert.rejects(beginCapture(999,{...meta,audioByteLength:limit+8},limit+8),/maximum 1 GiB/);
});

test('successful capture registers its original collection without duplicating membership in audio metadata', async () => {
  const { savedCollections } = await import('./collectionRegistry');
  const collection = {path:'playlist/1111111111111111111111',title:'Capture context',artwork:'',trackIds:['testCapture']};
  const id = await beginCapture(12,{...meta,collection},bytes.length);
  await appendCapture(12,id,0,b64(bytes));
  await finishCapture(12,id);
  assert.equal((await savedCollections()).find(c => c.path === collection.path)?.captured,1);
  assert.equal((await getTrack('spotify-testCapture'))?.metadata?.collection,undefined);
  await deleteTrack('spotify-testCapture');
});

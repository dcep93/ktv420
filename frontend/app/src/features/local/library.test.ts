import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInput, getTrack, getInput, saveStems, deleteTrack, getPlaybackRecord, STEM_NAMES, transaction } from './library.ts';

test('input survives reload, output commits atomically and deletion removes audio', async () => {
  const id = crypto.randomUUID(); const blob = new Blob([new Uint8Array(100)]);
  await saveInput({id, title:'test',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:100,source:'file'}, blob);
  assert.equal((await getInput(id)).size, 100);
  assert.equal((await getTrack(id))?.status, 'captured');
  const stems = Object.fromEntries(STEM_NAMES.map(name => [name, blob])) as Record<typeof STEM_NAMES[number], Blob>;
  await saveStems(id, stems, {});
  assert.equal((await getTrack(id))?.status, 'ready');
  assert.equal((await getTrack(id))?.bytes, 500);
  assert.equal((await getPlaybackRecord(id)).files.length, 5);
  await deleteTrack(id);
  assert.equal(await getTrack(id), undefined);
  assert.equal((await getPlaybackRecord(id)).files.length, 0);
});

test('aborted transaction rejects instead of reporting success', async () => {
  await assert.rejects(transaction(['tracks'], 'readwrite', tx => tx.abort()));
});

test('missing or invalid stems cannot publish a ready track', async () => {
  const id = crypto.randomUUID(); const blob = new Blob([new Uint8Array(100)]);
  await saveInput({id,title:'test',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:100,source:'file'}, blob);
  const stems = { drums:blob,bass:blob,other:blob,vocals:new Blob() };
  await assert.rejects(saveStems(id, stems, {}));
  assert.equal((await getTrack(id))?.status, 'captured');
  assert.equal((await getPlaybackRecord(id)).files.length, 1);
  await deleteTrack(id);
});

// A retained compressed source must be included in ready-state disk accounting.
test('source file stays intact after stems are committed', async () => {
 const id=crypto.randomUUID();const wav=new Blob([new Uint8Array(100)]);const source=new Blob(['original bytes']);
 await saveInput({id,title:'source',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:0,source:'file'},wav,source);
 const stems=Object.fromEntries(STEM_NAMES.map(name=>[name,wav])) as Record<typeof STEM_NAMES[number],Blob>;
 await saveStems(id,stems,{});
 assert.equal((await getTrack(id))?.bytes,500+source.size);
 assert.equal(await (await getPlaybackRecord(id)).files.find(file=>file.name==='source')!.blob.text(),'original bytes');
 await deleteTrack(id);
});

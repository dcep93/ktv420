import 'fake-indexeddb/auto';
import { MP3_NAMES } from './audio/mp3Types';
const encoding={sampleRate:44100,frames:7,gain:0.5};
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInput, getTrack, getInput, saveMp3, deleteTrack, getPlaybackRecord, transaction } from './library.ts';

test('input survives reload, output commits atomically and deletion removes audio', async () => {
  const id = crypto.randomUUID(); const blob = new Blob([new Uint8Array(500)]);
  await saveInput({id, title:'test',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:100,source:'file'}, blob);
  assert.equal((await getInput(id)).size, 500);
  assert.equal((await getTrack(id))?.status, 'captured');
  const stems = Object.fromEntries(MP3_NAMES.map(name => [name, blob])) as Record<typeof MP3_NAMES[number], Blob>;
  await saveMp3(id, stems, {}, encoding);
  assert.equal((await getTrack(id))?.status, 'ready');
  assert.equal((await getTrack(id))?.bytes, 2500);
  assert.equal((await getPlaybackRecord(id)).files.length, 5);
  await deleteTrack(id);
  assert.equal(await getTrack(id), undefined);
  assert.equal((await getPlaybackRecord(id)).files.length, 0);
});

test('aborted transaction rejects instead of reporting success', async () => {
  await assert.rejects(transaction(['tracks'], 'readwrite', tx => tx.abort()));
});

test('missing or invalid stems cannot publish a ready track', async () => {
  const id = crypto.randomUUID(); const blob = new Blob([new Uint8Array(500)]);
  await saveInput({id,title:'test',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:100,source:'file'}, blob);
  const stems = { input:blob, drums:blob,bass:blob,other:blob,vocals:new Blob() };
  await assert.rejects(saveMp3(id, stems, {}, encoding));
  assert.equal((await getTrack(id))?.status, 'captured');
  assert.equal((await getPlaybackRecord(id)).files.length, 1);
  await deleteTrack(id);
});

// Raw/source cleanup happens in the same commit as the five MP3s.
test('successful MP3 commit removes raw and source originals and accounts exact bytes', async () => {
 const id=crypto.randomUUID();const wav=new Blob([new Uint8Array(500)]);const source=new Blob(['original bytes']);
 await saveInput({id,title:'source',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:0,source:'file'},wav,source);
 const stems=Object.fromEntries(MP3_NAMES.map(name=>[name,wav])) as Record<typeof MP3_NAMES[number],Blob>;
 await saveMp3(id,stems,{},encoding);
 assert.equal((await getTrack(id))?.bytes,2500);
 assert.ok((await getPlaybackRecord(id)).files.every(file=>file.name.endsWith('.mp3')));
 await assert.rejects(getInput(id));
 assert.equal((await getPlaybackRecord(id)).playbackGain,0.5);
 await deleteTrack(id);
});

test('abort after MP3 writes rolls back deletion, bytes, gain and ready status',async()=>{
 const id=crypto.randomUUID(),raw=new Blob([new Uint8Array(500)]),source=new Blob(['source']);
 await saveInput({id,title:'rollback',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:0,source:'file'},raw,source);
 const files=Object.fromEntries(MP3_NAMES.map(name=>[name,raw])) as Record<typeof MP3_NAMES[number],Blob>;
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){
  const request=put.call(this,value,key);
  if(this.name==='audio'&&value.name==='vocals.mp3')this.transaction.abort();
  return request;
 };
 try{await assert.rejects(saveMp3(id,files,{},encoding));}finally{IDBObjectStore.prototype.put=put;}
 assert.equal((await getTrack(id))?.status,'captured');
 assert.equal((await getTrack(id))?.bytes,raw.size+source.size);
 assert.equal((await getTrack(id))?.playbackGain,undefined);
 assert.equal((await getPlaybackRecord(id)).files.length,2);
 assert.equal((await getInput(id)).size,raw.size);
 await deleteTrack(id);
});

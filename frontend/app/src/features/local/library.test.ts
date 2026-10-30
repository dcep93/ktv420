import { encodeMp3Set } from './audio/mp3';
import 'fake-indexeddb/auto';
import { MP3_NAMES } from './audio/mp3Types';
const encoding={sampleRate:44100,frames:7,gain:0.5};
const audio={left:new Float32Array(7),right:new Float32Array(7),sampleRate:44100};
const validFiles=(await encodeMp3Set(audio,{bass:audio,drums:audio,other:audio,vocals:audio})).files;
const encodedBytes=Object.values(validFiles).reduce((sum,b)=>sum+b.size,0);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInput, getTrack, getInput, saveMp3, deleteTrack, getPlaybackRecord, transaction } from './library.ts';

test('input survives reload, output commits atomically and deletion removes audio', async () => {
  const id = crypto.randomUUID(); const blob = new Blob([new Uint8Array(500)]);
  await saveInput({id, title:'test',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:100,source:'file'}, blob);
  assert.equal((await getInput(id)).size, 500);
  assert.equal((await getTrack(id))?.status, 'captured');
  const stems = Object.fromEntries(MP3_NAMES.map(name => [name, validFiles[name]])) as Record<typeof MP3_NAMES[number], Blob>;
  await saveMp3(id, stems, {}, encoding);
  assert.equal((await getTrack(id))?.status, 'ready');
  assert.equal((await getTrack(id))?.bytes, encodedBytes);
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
 const stems=Object.fromEntries(MP3_NAMES.map(name=>[name,validFiles[name]])) as Record<typeof MP3_NAMES[number],Blob>;
 await saveMp3(id,stems,{},encoding);
 assert.equal((await getTrack(id))?.bytes,encodedBytes);
 assert.ok((await getPlaybackRecord(id)).files.every(file=>file.name.endsWith('.mp3')));
 await assert.rejects(getInput(id));
 assert.equal((await getPlaybackRecord(id)).playbackGain,0.5);
 await deleteTrack(id);
});

test('abort after MP3 writes rolls back deletion, bytes, gain and ready status',async()=>{
 const id=crypto.randomUUID(),raw=new Blob([new Uint8Array(500)]),source=new Blob(['source']);
 await saveInput({id,title:'rollback',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:0,source:'file'},raw,source);
 const files=Object.fromEntries(MP3_NAMES.map(name=>[name,validFiles[name]])) as Record<typeof MP3_NAMES[number],Blob>;
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

test('invalid timing or structurally corrupt MP3 retains the original input', async()=>{
 const id=crypto.randomUUID(),raw=new Blob(['raw']);
 await saveInput({id,title:'validation',artist:'',createdAt:1,sampleRate:44100,frames:7,status:'captured',bytes:0,source:'file'},raw);
 await assert.rejects(saveMp3(id,validFiles,{}, {...encoding,frames:8}),/does not match/);
 await assert.rejects(saveMp3(id,{...validFiles,bass:new Blob([new Uint8Array(500)])},{},encoding),/MP3/);
 assert.equal((await getTrack(id))?.status,'captured');assert.equal(await (await getInput(id)).text(),'raw');await deleteTrack(id);
});

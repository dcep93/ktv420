import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processLocalTrack } from './processing.ts';
import { encodeFloat32Wav } from './audio/wav.ts';
import type { SeparationResult } from './inference/types';
import type { TrackStatus } from './library.ts';
const audio={left:new Float32Array([0.1,0.2]),right:new Float32Array([0.3,0.4]),sampleRate:44100};
const encoded={files:{} as import('./audio/mp3Types').Mp3Files,encoding:{sampleRate:44100,frames:2,gain:1}};
const encode=async()=>encoded;
const result={drums:audio,bass:audio,other:audio,vocals:audio,metadata:{}} as SeparationResult;
test('cancellation during input loading never invokes inference and preserves original', async()=>{
 let cancelled=false, called=false;let state:TrackStatus='captured';
 await processLocalTrack('id',{separateStereo:async()=>{called=true;return result;}},()=>cancelled,()=>{}, {
  setTrackStatus:async(_id,status)=>{state=status;},
  getInput:async()=>{cancelled=true;return new Blob([encodeFloat32Wav(audio)]);},
  saveMp3:async()=>{throw new Error('Must not save');},
 },encode);
 assert.equal(called,false); assert.equal(state,'captured');
});
test('cancellation during successful storage commit preserves ready state',async()=>{
 let cancelled=false; let state:TrackStatus='captured';
 await processLocalTrack('id',{separateStereo:async()=>result},()=>cancelled,()=>{}, {
  setTrackStatus:async(_id,status)=>{state=status;},
  getInput:async()=>new Blob([encodeFloat32Wav(audio)]),
  saveMp3:async()=>{cancelled=true;state='ready';},
 },encode);
 assert.equal(state,'ready');
});
test('inference failure is visible and leaves input available for retry',async()=>{
 let state:TrackStatus='captured';let message='';
 await assert.rejects(processLocalTrack('id',{separateStereo:async()=>{throw new Error('GPU unavailable');}},()=>false,()=>{}, {
  setTrackStatus:async(_id,status,error)=>{state=status;message=error||'';},
  getInput:async()=>new Blob([encodeFloat32Wav(audio)]), saveMp3:async()=>{},
 },encode));
 assert.equal(state,'error');assert.equal(message,'GPU unavailable');
});

test('encoding failure leaves retryable raw input and never commits',async()=>{
 let state:TrackStatus='captured',saved=false;
 await assert.rejects(processLocalTrack('id',{separateStereo:async()=>result},()=>false,()=>{}, {
  setTrackStatus:async(_id,status)=>{state=status;},getInput:async()=>new Blob([encodeFloat32Wav(audio)]),saveMp3:async()=>{saved=true;},
 },async()=>{throw new Error('Encoder failed');}),/Encoder failed/);
 assert.equal(state,'error');assert.equal(saved,false);
});
test('cancellation after encoding and a failed commit both retain captured state',async()=>{
 for(const duringCommit of [false,true]) {
  let cancelled=false,saved=false;let state:TrackStatus='captured';
  await processLocalTrack('id',{separateStereo:async()=>result},()=>cancelled,()=>{}, {
   setTrackStatus:async(_id,status)=>{state=status;},getInput:async()=>new Blob([encodeFloat32Wav(audio)]),
   saveMp3:async()=>{saved=true;cancelled=true;throw new Error('Aborted commit');},
  },async()=>{cancelled=!duringCommit;return encoded;});
  assert.equal(state,'captured');assert.equal(saved,duringCommit);
 }
});

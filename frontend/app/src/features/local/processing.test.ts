import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processLocalTrack } from './processing.ts';
import { encodeFloat32Wav } from './audio/wav.ts';
import type { SeparationResult } from './inference/types';
import type { TrackStatus } from './library.ts';
const audio={left:new Float32Array([0.1,0.2]),right:new Float32Array([0.3,0.4]),sampleRate:44100};
const result={drums:audio,bass:audio,other:audio,vocals:audio,metadata:{}} as SeparationResult;
test('cancellation during input loading never invokes inference and preserves original', async()=>{
 let cancelled=false, called=false;let state:TrackStatus='captured';
 await processLocalTrack('id',{separateStereo:async()=>{called=true;return result;}},()=>cancelled,()=>{}, {
  setTrackStatus:async(_id,status)=>{state=status;},
  getInput:async()=>{cancelled=true;return new Blob([encodeFloat32Wav(audio)]);},
  saveStems:async()=>{throw new Error('Must not save');},
 });
 assert.equal(called,false); assert.equal(state,'captured');
});
test('cancellation during successful storage commit preserves ready state',async()=>{
 let cancelled=false; let state:TrackStatus='captured';
 await processLocalTrack('id',{separateStereo:async()=>result},()=>cancelled,()=>{}, {
  setTrackStatus:async(_id,status)=>{state=status;},
  getInput:async()=>new Blob([encodeFloat32Wav(audio)]),
  saveStems:async()=>{cancelled=true;state='ready';},
 });
 assert.equal(state,'ready');
});
test('inference failure is visible and leaves input available for retry',async()=>{
 let state:TrackStatus='captured';let message='';
 await assert.rejects(processLocalTrack('id',{separateStereo:async()=>{throw new Error('GPU unavailable');}},()=>false,()=>{}, {
  setTrackStatus:async(_id,status,error)=>{state=status;message=error||'';},
  getInput:async()=>new Blob([encodeFloat32Wav(audio)]), saveStems:async()=>{},
 }));
 assert.equal(state,'error');assert.equal(message,'GPU unavailable');
});

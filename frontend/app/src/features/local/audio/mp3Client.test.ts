import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMp3InWorker } from './mp3Client';
const audio={left:new Float32Array(2),right:new Float32Array(2),sampleRate:44100};
test('cancelling encoding terminates its worker and rejects promptly', async()=>{
 const previous=globalThis.Worker;
 let terminated=false,cancelled=false,posted=false;
 class FakeWorker { postMessage(){posted=true;cancelled=true;} terminate(){terminated=true;} }
 globalThis.Worker=FakeWorker as unknown as typeof Worker;
 try {
  await assert.rejects(encodeMp3InWorker(audio,{drums:audio,bass:audio,other:audio,vocals:audio},()=>cancelled,()=>{}),{name:'AbortError'});
  assert.equal(posted,true);assert.equal(terminated,true);
 }finally{globalThis.Worker=previous;}
});

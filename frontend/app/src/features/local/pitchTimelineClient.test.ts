import test from 'node:test';
import assert from 'node:assert/strict';
import { PitchTimelineClient } from '../stems/player/visuals/pitchTimelineClient';
import type { PitchRequest, PitchResponse } from '../stems/player/visuals/pitchWorker';
class FakeWorker {
  onmessage:Worker['onmessage']=null;onerror:Worker['onerror']=null;onmessageerror:Worker['onmessageerror']=null;
  requests:PitchRequest[]=[];terminated=false;
  postMessage(data:PitchRequest){this.requests.push(data);}
  terminate(){this.terminated=true;}
  respond(request=this.requests.at(-1)!) {
    const samples={pitches:new Float32Array(request.count).fill(6),levels:new Float32Array(request.count).fill(.1),hues:new Float32Array(request.count).fill(50)};
    this.deliver({id:request.id,first:request.first,samples});
  }
  deliver(data:PitchResponse){this.onmessage?.call(this as unknown as Worker,{data} as MessageEvent);}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function source(seconds=60){const data=new Float32Array(seconds*48000).fill(.1);return {length:data.length,sampleRate:48000,numberOfChannels:2,getChannelData:()=>data};}
test('worker transfers bounded copies, caches chunks and prioritizes seeks across stems',async()=>{
  const worker=new FakeWorker(),client=new PitchTimelineClient(()=>{},()=>worker),buffer=source();
  try {
    client.add('a',buffer);client.add('b',buffer);await tick();
    assert.equal(worker.requests.length,1);const first=worker.requests[0];
    assert.ok(first.channels[0].length<=48000*10.8);
    assert.notEqual(first.channels[0].buffer,buffer.getChannelData().buffer);
    worker.respond();await tick();assert.equal(worker.requests[1].id,'b');
    client.setTime(45);worker.respond();await tick();
    assert.equal(worker.requests[2].first,800,'seek reprioritizes next chunk at source 40s');
    assert.equal(client.get('a')!.ready[0],1);assert.equal(client.get('a')!.ready[800],0);
    const cached=client.get('a');client.add('a',buffer);assert.equal(client.get('a'),cached);
  } finally {client.dispose();}
  assert.ok(worker.terminated);
});
test('failed analysis does not prevent other tracks; disposal ignores late messages',async()=>{
  const worker=new FakeWorker();let changes=0;
  const client=new PitchTimelineClient(()=>changes++,()=>worker);
  client.add('a',source(1));client.add('b',source(1));await tick();
  worker.deliver({id:'a',first:0,error:'Analysis failed'});await tick();
  assert.equal(client.get('a')!.failed,true);assert.equal(worker.requests.at(-1)!.id,'b');
  client.dispose();const before=changes;worker.respond();await tick();assert.equal(changes,before);
});
test('worker startup failure is isolated from playback',async()=>{
  let changes=0;const client=new PitchTimelineClient(()=>changes++,()=>{throw new Error('blocked worker');});
  client.add('a',source(1));await tick();assert.equal(client.get('a')!.failed,true);assert.equal(changes,1);client.dispose();
});

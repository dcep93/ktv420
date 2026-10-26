import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedCaptureQueue } from './hostedCapture';
test('hosted queue preserves order, skips saved songs and deduplicates captures',async()=>{
  const q=new HostedCaptureQueue(),calls:string[]=[],states:boolean[]=[];
  assert.equal(await q.run(['a','b','a','c'],()=>new Set(['b']),async id=>{calls.push(id);},()=>states.push(q.active)),true);
  assert.deepEqual(calls,['a','c']);assert.equal(states[0],true);assert.equal(states.at(-1),false);assert.equal(q.completed,3);
});
test('cancellation during a pending capture never advances the queue',async()=>{
  const q=new HostedCaptureQueue(),calls:string[]=[]; let resolve!:()=>void;
  const p=q.run(['a','b'],()=>new Set(),async id=>{calls.push(id);await new Promise<void>(r=>resolve=r);},()=>{});
  q.cancel();resolve();assert.equal(await p,false);assert.deepEqual(calls,['a']);assert.equal(q.active,false);
});
test('capture failure stops the queue without retrying or advancing',async()=>{
  const q=new HostedCaptureQueue(),calls:string[]=[];
  await assert.rejects(q.run(['a','b'],()=>new Set(),async id=>{calls.push(id);throw Error('timing failed');},()=>{}),/timing failed/);
  assert.deepEqual(calls,['a']);assert.equal(q.active,false);
});
test('concurrent runs cannot capture twice',async()=>{
  const q=new HostedCaptureQueue();let resolve!:()=>void;
  const p=q.run(['a'],()=>new Set(),()=>new Promise<void>(r=>resolve=r),()=>{});
  assert.equal(await q.run(['b'],()=>new Set(),async()=>{throw Error('must not run');},()=>{}),false);
  resolve();assert.equal(await p,true);
});

test('album capture includes rows that arrive after the run starts', async () => {
  const queue = new HostedCaptureQueue(), captured:string[] = [];
  let rows = ['a', 'b'];
  await queue.run(() => rows, () => new Set(), async id => {
    captured.push(id);
    if (id === 'b') rows = ['a', 'b', 'c', 'd'];
  }, () => {});
  assert.deepEqual(captured, ['a', 'b', 'c', 'd']);
  assert.equal(queue.total, 4);
  assert.equal(queue.completed, 4);
});

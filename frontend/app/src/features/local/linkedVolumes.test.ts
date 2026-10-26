import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedVolumes } from '../stems/player/linkedVolumes';
const ids = ['original', 'bass', 'drums', 'vocals'];
const initial = { original: 1, bass: 1, drums: .8, vocals: .6 };
const near = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('unlocked edits only change the selected slider; inputs remain unchanged', () => {
  assert.deepEqual(linkedVolumes(initial, {}, ids, 'bass', 1.4), {...initial,bass:1.4});
  assert.deepEqual(initial, {original:1,bass:1,drums:.8,vocals:.6});
});
test('locked slider moves every unlocked track including Original inversely', () => {
  const next = linkedVolumes(initial, {bass:true,vocals:true}, ids, 'bass', 1.4);
  near(next.bass,1.4);near(next.original,.6);near(next.drums,.4);near(next.vocals,.6);
  const back = linkedVolumes(next, {bass:true,vocals:true}, ids, 'bass', 1);
  for(const id of ids)near(back[id],initial[id as keyof typeof initial]);
});
test('all locked protects peers, and Original can drive the link', () => {
  assert.deepEqual(linkedVolumes(initial, Object.fromEntries(ids.map(id=>[id,true])),ids,'bass',2),{...initial,bass:2});
  const next=linkedVolumes(initial,{original:true},ids,'original',.5);
  near(next.bass,1.5);near(next.drums,1.3);near(next.vocals,1.1);
});
test('bounds discard excess movement without remembering any former balance', () => {
  const zero=linkedVolumes(initial,{bass:true},ids,'bass',2);
  assert.deepEqual(zero,{original:0,bass:2,drums:0,vocals:0});
  const back=linkedVolumes(zero,{bass:true},ids,'bass',1);
  assert.deepEqual(back,{original:1,bass:1,drums:1,vocals:1});
  assert.equal(linkedVolumes({bass:1,drums:.2},{bass:true},['bass','drums'],'bass',1.2).drums,0,'zero must be exact silence, not floating-point residue');
  const lower=linkedVolumes({bass:.1,drums:1.95},{bass:true},['bass','drums'],'bass',-1);
  assert.deepEqual(lower,{bass:0,drums:2});
  assert.deepEqual(linkedVolumes(zero,{bass:true},ids,'bass',3),zero,'clamped source has no extra delta');
});
test('successive input uses current positions and unlocking immediately stops linking', () => {
  let values:Record<string,number>={bass:1,drums:1};
  for(let step=1;step<=100;step++)values=linkedVolumes(values,{bass:true},['bass','drums'],'bass',1+step/100);
  assert.equal(values.drums,0);
  const independent=linkedVolumes(values,{},['bass','drums'],'bass',1);
  near(independent.drums,0);near(independent.bass,1);
});
test('nonfinite or unknown edits are ignored and inactive stale keys do not participate',()=>{
  for(const value of [NaN,Infinity,-Infinity])assert.equal(linkedVolumes(initial,{},ids,'bass',value),initial);
  assert.equal(linkedVolumes(initial,{},ids,'missing',1),initial);
  const next=linkedVolumes({...initial,stale:.9},{bass:true},ids,'bass',1.5);
  assert.equal(next.stale,.9);
});

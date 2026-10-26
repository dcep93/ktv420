import test from 'node:test';
import assert from 'node:assert/strict';
import { createHighwayAtmosphere, updateHighwayAtmosphere, highwayDesert } from '../stems/player/visuals/highwayAtmosphere';
function run(signal:(time:number)=>number, seconds=60, fps=60) {
  const state=createHighwayAtmosphere();
  for(let frame=0;frame<=seconds*fps;frame++)updateHighwayAtmosphere(state,signal(frame/fps),frame/fps,true);
  return state;
}
test('Highway sustained intensity sets daylight slowly, without following short loud hits',()=>{
  const loud=run(()=>1),quiet=run(()=>0);
  assert.ok(loud.daylight>.95);assert.ok(quiet.daylight<.02);
  assert.ok(run(()=>1,1).daylight<.28);
  assert.ok(run(t=>t<1?1:0,15).daylight<.15);
  for(const fps of [30,60,120])assert.ok(Math.abs(run(()=>1,30,fps).daylight-run(()=>1,30).daylight)<.002);
  const state=run(()=>1);const before=state.daylight;
  for(let frame=1;frame<=60;frame++)updateHighwayAtmosphere(state,0,60+frame/60,true);
  assert.ok(before-state.daylight<1/35+.001);
});
test('Highway faster rhythmic attacks fill the sky, while a sustained loud tone does not',()=>{
  const pulse=(rate:number)=>(time:number)=>time*rate%1<.35?.8:.05;
  const slow=run(pulse(.5)),fast=run(pulse(4)),steady=run(()=>.8);
  assert.ok(fast.density>.9);assert.ok(slow.density<.4);
  assert.ok(fast.density>slow.density+.5);assert.equal(steady.density,0);
  const stopped=fast.density;
  for(let frame=1;frame<=60*20;frame++)updateHighwayAtmosphere(fast,0,60+frame/60,true);
  assert.ok(fast.density<stopped*.05);
});
test('Highway pause and seek preserve the sky and do not manufacture rhythmic attacks',()=>{
  const state=run(t=>t*3%1<.35?.8:.05,10);
  const values=()=>[state.daylight,state.density,state.activity];
  const before=values();
  for(let i=0;i<100;i++)updateHighwayAtmosphere(state,1,10,false);
  assert.deepEqual(values(),before);
  updateHighwayAtmosphere(state,1,100,true);assert.deepEqual(values(),before);
  updateHighwayAtmosphere(state,1,2,true);assert.deepEqual(values(),before);
  updateHighwayAtmosphere(state,1,2+1/60,true);
  assert.ok(state.activity<=before[2]);
});
test('Highway desert is smoothly periodic and independent of audio',()=>{
  for(let i=0;i<=3600;i++){
    const time=i/60,value=highwayDesert(time);
    assert.ok(value>=.18 && value<=1);
    assert.ok(Math.abs(value-highwayDesert(time+60))<1e-12);
    assert.ok(Math.abs(value-highwayDesert(time+1/60))<.001);
  }
  assert.ok(highwayDesert(30)>.99);assert.equal(highwayDesert(0),.18);
});

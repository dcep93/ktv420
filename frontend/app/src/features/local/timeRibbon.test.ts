import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTimeRibbon, ribbonHue, ribbonRange, ribbonX } from '../stems/player/visuals/timeRibbon';
import { AMPLITUDE_WINDOW_SECONDS } from '../stems/player/types';

test('ribbon vertices translate rigidly instead of changing narrow peaks during scrolling',()=>{
  const width=1234,time=12.345,dt=1/60;
  for(let index=0;index<1000;index++){
    assert.ok(Math.abs(ribbonX(index,time+dt,width)-ribbonX(index,time,width)+dt/20*width)<1e-10);
  }
  for(const time of [0,5,12.345,99999]){
    const {first,last}=ribbonRange(time);
    assert.ok(ribbonX(first,time,width)<0);
    assert.ok(ribbonX(last,time,width)>width);
    assert.ok(last-first<=403);
    assert.equal(AMPLITUDE_WINDOW_SECONDS,.05);
  }
});
test('competing frequencies cannot flash hue; pause, silence and seeks preserve the last color',()=>{
  let state=ribbonHue(undefined,0,0,true);
  for(let frame=1;frame<120;frame++){
    const next=ribbonHue(state,frame%2?280:0,frame/60,true);
    const difference=Math.abs(((next.hue-state.hue+540)%360)-180);
    assert.ok(difference<=75/60+1e-9);
    state=next;
  }
  assert.equal(ribbonHue(state,180,10,false).hue,state.hue);
  assert.equal(ribbonHue(state,null,10,true).hue,state.hue);
  assert.equal(ribbonHue(state,180,0,true).hue,state.hue);
  const seek=ribbonHue(state,180,10000,true);
  assert.ok(Math.abs(((seek.hue-state.hue+540)%360)-180)<=3.75+1e-9);
});
test('renderer stays finite and balanced at silence, track boundaries and short heights',()=>{
  let depth=0,operations=0,reads=0;
  const c=new Proxy({},{
    get(_t,key){
      if(key==='createLinearGradient')return()=>({addColorStop(){}});
      return(...args:unknown[])=>{
        operations++;for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a),String(key));
        if(key==='save')depth++;if(key==='restore')depth--;
      };
    },set(){return true;},
  });
  const canvas={width:1050,height:30,getContext:()=>c} as unknown as HTMLCanvasElement;
  const analyser={frequencyBinCount:1024,getByteFrequencyData(data:Uint8Array){reads++;data.fill(0);data[4]=255;data[92]=254;}} as unknown as AnalyserNode;
  for(const time of [0,1/60,15,30,0]){
    operations=0;
    drawTimeRibbon({canvas,analyser,visualizerType:'time-ribbon',sampleRate:44100,currentTime:time,duration:20,isPlaying:true,amplitudeMaximum:0,
      amplitudeEnvelope:Array.from({length:400},(_,i)=>i%3===0?.8:0)});
    assert.equal(depth,0);assert.ok(operations<600);
  }
  assert.equal(reads,5);
});

test('Super ribbon movement is smoothed, bounded and frozen when paused',async()=>{
  const {ribbonMotion}=await import('../stems/player/visuals/timeRibbon');
  let state=ribbonMotion(undefined,0,0,true);
  for(let i=1;i<180;i++){
    const next=ribbonMotion(state,i%2?1:0,i/60,true);
    assert.ok(next.level>=0&&next.level<=1);
    assert.ok(Math.abs(next.level-state.level)<.07);
    state=next;
  }
  assert.equal(ribbonMotion(state,0,10,false).level,state.level);
  assert.equal(ribbonMotion(state,1,0,true).level,state.level);
});

test('Super ribbon adds bounded layers and sparks, holds exactly on pause, and survives seeks',()=>{
 let depth=0,trace:unknown[][]=[];
 const c=new Proxy({}, {
  get(_t,key){
   if(key==='createLinearGradient'||key==='createRadialGradient')return(...args:unknown[])=>{
    trace.push([key,...args]);return {addColorStop(...values:unknown[]){trace.push(['colorStop',...values]);}};
   };
   return(...args:unknown[])=>{
    trace.push([key,...args]);for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a),String(key));
    if(key==='save')depth++;if(key==='restore')depth--;assert.ok(depth>=0);
   };
  },set(_t,key,value){trace.push([key,typeof value==='object'?'gradient':value]);return true;},
 });
 const analyser={fftSize:128,frequencyBinCount:64,
  getByteTimeDomainData(data:Uint8Array){data.fill(180);},
  getByteFrequencyData(data:Uint8Array){data.fill(50);},
 } as unknown as AnalyserNode;
 const envelope=Array.from({length:6000},(_,i)=>.1+(i%10===0?.8:.2));
 for(const [width,height] of [[360,100],[1100,520],[100,30]]){
  const canvas={width,height,getContext:()=>c} as unknown as HTMLCanvasElement;
  const inputs={canvas,analyser,visualizerType:'super-time-ribbon' as const,sampleRate:44100,currentTime:12.123,duration:300,isPlaying:true,amplitudeMaximum:1,amplitudeEnvelope:envelope};
  drawTimeRibbon(inputs);trace=[];
  inputs.isPlaying=false;drawTimeRibbon(inputs);const paused=trace;
  trace=[];drawTimeRibbon(inputs);assert.deepEqual(trace,paused,'paused geometry/color must not drift');
  assert.equal(depth,0);assert.ok(trace.length>2500&&trace.length<5000,`${trace.length} operations`);
  for(const time of [0,299.9,15,0]){
   trace=[];drawTimeRibbon({...inputs,currentTime:time,isPlaying:true});assert.equal(depth,0);assert.ok(trace.length<5000);
  }
 }
});

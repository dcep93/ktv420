import { OctaveLayer } from '../stems/player/effects/octave';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReverseGrains, SampleDelay } from '../stems/player/effects/timeEffects';
import { StereoEffects, type EffectControl } from '../stems/player/effects/dsp';
import { effectIds, getDefaultEffectValue, type AudioEffectType } from '../stems/player/effects/catalog';
import { validSnapshot } from './recording';
const control = (effect:AudioEffectType, amount:number):EffectControl => ({effect:effectIds.indexOf(effect),amount,bypass:0,bpm:120,beats:.5,tempo:1});
function amplitude(samples:Float32Array,frequency:number,rate:number,start=rate) {
  let real=0,imaginary=0;
  for(let i=start;i<samples.length;i++){const phase=2*Math.PI*frequency*i/rate;real+=samples[i]*Math.cos(phase);imaginary+=samples[i]*Math.sin(phase);}
  return 2*Math.hypot(real,imaginary)/(samples.length-start);
}
test('Octave shifts actual frequencies up and down, preserving stereo isolation and audible blend',()=>{
  for(const rate of [44100,48000])for(const [amount,ratio] of [[0,.5],[1,2]]){
    const dsp=new StereoEffects(rate),c=control('octave',amount),samples=new Float32Array(rate*2);
    for(let i=0;i<samples.length;i++){const x=.1*Math.sin(2*Math.PI*440*i/rate);dsp.tick(x,0,c,i/rate);samples[i]=dsp.left;assert.equal(dsp.right,0);}
    assert.ok(amplitude(samples,440,rate)>.09,'dry source remains');
    const shifted=amplitude(samples,440*ratio,rate);
    assert.ok(shifted>.025,`audible ${ratio}×: ${shifted}`);
    assert.ok(amplitude(samples,440*(ratio===2?.5:2),rate)<shifted*.2,'does not produce the opposite octave');
  }
});
test('octave-up band limiting reduces high-frequency foldback',()=>{
  const rate=48000,layer=new OctaveLayer(rate,1),output=new Float32Array(rate*2);
  for(let i=0;i<output.length;i++){layer.tick(.2*Math.sin(2*Math.PI*18000*i/rate),0);output[i]=layer.left;}
  assert.ok(amplitude(output,12000,rate)<.004,'18 kHz must not become a loud aliased 12 kHz');
});
test('Reverse Echo plays past markers in reverse order with no pre-echo and aligned channels',()=>{
  const span=1000,lines=[new SampleDelay(4000),new SampleDelay(4000)],reverse=new ReverseGrains();
  const output:number[]=[];
  for(let i=0;i<2000;i++){
    reverse.tick(lines,span);
    const x=i===100?.4:i===300?.8:0;
    lines[0].write(x);lines[1].write(-x);
    if(Math.abs(reverse.left)>1e-7)output.push(i);
    assert.equal(reverse.right,-reverse.left || 0);
    if(i<500)assert.equal(reverse.left,0);
  }
  assert.ok(output.includes(699));assert.ok(output.includes(899));
  assert.ok(output.indexOf(699)<output.indexOf(899));
});
test('reverse phrase length follows tempo and BPM, with audible processed audio',()=>{
  for(const tempo of [.5,1,2]){
    const rate=16000,dsp=new StereoEffects(rate),c={...control('reverse-echo',1),tempo};
    const span=Math.round(rate*.25/tempo),impulse=Math.round(span*.1);let first=-1,peak=0;
    for(let i=0;i<span*3;i++){
      dsp.tick(i===impulse?.2:0,0,c,i/rate);
      if(i>impulse+1&&Math.abs(dsp.left)>1e-6){if(first<0)first=i;peak=Math.max(peak,Math.abs(dsp.left));}
    }
    assert.equal(first,span-1-impulse);
    assert.ok(peak>.08,`audible reverse repeat: ${peak}`);
  }
});
test('Shimmer adds an octave-up tail, preserves dry attack, and decays without runaway feedback',()=>{
  const rate=16000,dsp=new StereoEffects(rate),c=control('shimmer-reverb',1),samples=new Float32Array(rate*8);
  let early=0,late=0;
  for(let i=0;i<samples.length;i++){
    dsp.tick(i<rate*2?.15*Math.cos(2*Math.PI*440*i/rate):0,0,c,i/rate);
    samples[i]=dsp.left;assert.ok(Number.isFinite(dsp.left)&&Math.abs(dsp.left)<=1);
    if(i===0)assert.ok(dsp.left>=.119,'immediate dry attack');
    if(i>rate*2&&i<rate*3)early+=dsp.left*dsp.left+dsp.right*dsp.right;
    if(i>rate*7)late+=dsp.left*dsp.left+dsp.right*dsp.right;
  }
  assert.ok(amplitude(samples.subarray(0,rate*2),880,rate)>.004,'octave-up content is audible');
  assert.ok(early>.001,'tail continues after input');assert.ok(late<early*.001,'tail decays');
});
test('new effect automation is reproducible, smooth and accepted in replay snapshots',()=>{
  for(const effect of ['octave','reverse-echo','shimmer-reverb'] as const){
    const rate=16000,a=new StereoEffects(rate),b=new StereoEffects(rate),c=control(effect,getDefaultEffectValue(effect));
    let previous=0,maxStep=0;
    for(let i=0;i<rate*4;i++){
      if(i===rate/2)c.amount=effect==='octave'?0:1;
      if(i===rate)c.amount=1;
      if(i===rate*1.5){c.bpm=87;c.beats=1;c.tempo=.75;}
      if(i===rate*2)c.amount=getDefaultEffectValue(effect);
      const input=.1*Math.sin(2*Math.PI*200*i/rate);
      a.tick(input,-input,c,i/rate);b.tick(input,-input,c,i/rate);
      assert.equal(a.left,b.left);assert.equal(a.right,b.right);
      maxStep=Math.max(maxStep,Math.abs(a.left-previous));previous=a.left;
      if(i>rate*3)assert.equal(a.left,input,'returns to clean');
    }
    assert.ok(maxStep<.08,`${effect} control step: ${maxStep}`);
    assert.ok(validSnapshot({visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect,value:.8,effectSettings:{bypass:false,bpm:87,beats:1}}]}));
  }
});

test('Octave remains audible across bass, vocal and instrumental notes and shifts chords',()=>{
  const rate=48000;
  for(const frequency of [55,73.416,110,146.83,220,329.63,440,880,1760,4000])for(const direction of [-1,1] as const){
    const layer=new OctaveLayer(rate,direction),samples=new Float32Array(rate*2);
    for(let i=0;i<samples.length;i++){layer.tick(.1*Math.sin(2*Math.PI*frequency*i/rate),0);samples[i]=layer.left;}
    const level=amplitude(samples,frequency*(direction===1?2:.5),rate);
    assert.ok(level>.018,`${frequency}Hz, direction ${direction}: ${level}`);
  }
  const layer=new OctaveLayer(rate,1),samples=new Float32Array(rate*3),notes=[220,329.63,440];
  for(let i=0;i<samples.length;i++){let input=0;for(const f of notes)input+=.04*Math.sin(2*Math.PI*f*i/rate);layer.tick(input,0);samples[i]=layer.left;}
  for(const f of notes)assert.ok(amplitude(samples,f*2,rate)>.009,`chord note ${f}`);
});

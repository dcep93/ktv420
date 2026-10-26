import test from 'node:test';
import assert from 'node:assert/strict';
import { StereoEffects, type EffectControl } from '../stems/player/effects/dsp';
import { audioEffectOptions, effectIds, getDefaultEffectValue, type AudioEffectType, validEffectSettings } from '../stems/player/effects/catalog';
import { validSnapshot } from './recording';
const rate=16000;
function control(effect:AudioEffectType,amount:number):EffectControl{return {effect:effectIds.indexOf(effect),amount,bypass:0,bpm:120,beats:.5,tempo:1};}
function render(effect:AudioEffectType,amount:number,seconds=1,frequency=1000,amplitude=.2){
 const dsp=new StereoEffects(rate),c=control(effect,amount),left=new Float32Array(rate*seconds),right=new Float32Array(left.length);
 for(let i=0;i<left.length;i++){const input=amplitude*Math.sin(2*Math.PI*frequency*i/rate);dsp.tick(input,input,c,i/rate);left[i]=dsp.left;right[i]=dsp.right;}
 return {left,right};
}
const rms=(data:Float32Array,start=0)=>Math.sqrt(data.subarray(start).reduce((sum,x)=>sum+x*x,0)/(data.length-start));
test('every visible effect is exactly transparent at neutral and bypass',()=>{
 for(const option of audioEffectOptions){
  const dsp=new StereoEffects(rate),c=control(option.value,getDefaultEffectValue(option.value));
  for(let i=0;i<300;i++){const l=Math.sin(i)*.2,r=Math.cos(i)*.1;dsp.tick(l,r,c,i/rate);assert.equal(dsp.left,l);assert.equal(dsp.right,r);}
  const bypass=new StereoEffects(rate);c.amount=.9;c.bypass=1;
  for(let i=0;i<300;i++){const l=Math.sin(i)*.2; bypass.tick(l,-l,c,i/rate);assert.equal(bypass.left,l);assert.equal(bypass.right,-l);}
 }
});
test('Wah resonant gain is bounded, including the former 24 dB surge',()=>{
 for(const amount of [.1,.25,.5,.75,.9]){
  const frequency=220*(3400/220)**amount;
  const {left}=render('wah',amount,1,frequency);
  assert.ok(Math.max(...left.map(Math.abs))<.205);
 }
});
test('all effect IDs remain finite with controlled test-tone gain',()=>{
 for(const effect of effectIds)for(const amount of [.25,.75,1]){
  const {left,right}=render(effect,amount,.25);
  for(let i=0;i<left.length;i++){assert.ok(Number.isFinite(left[i])&&Number.isFinite(right[i]),effect);assert.ok(Math.abs(left[i])<.65,effect);}
 }
});
test('chorus creates stereo difference; envelope filter follows input dynamics',()=>{
 const {left,right}=render('chorus',1);
 assert.ok(rms(left.map((x,i)=>x-right[i]),rate/2)>.01);
 const quiet=rms(render('envelope-filter',1,1,3000,.01).left,rate/2)/.01;
 const loud=rms(render('envelope-filter',1,1,3000,.2).left,rate/2)/.2;
 assert.ok(loud>quiet*1.5,`${loud} > ${quiet}`);
});
test('echo interval is independent of amount and tracks supplied BPM and tempo',()=>{
 for(const [amount,tempo,bpm] of [[.3,1,120],[.9,1,120],[.9,1.5,120],[.9,1,90]]){
  const dsp=new StereoEffects(rate),c={...control('delay-pedal',amount),tempo,bpm};let first=-1;
  for(let i=0;i<rate;i++){dsp.tick(i===0?.2:0,0,c,i/rate);if(i>10&&Math.abs(dsp.left)>1e-6&&first<0)first=i;}
  assert.ok(Math.abs(first-rate*60/bpm*.5/tempo)<=1,`${first}`);
 }
});
test('reverb retains a finite tail while amount changes; snapshots never clear its history',()=>{
 const dsp=new StereoEffects(rate),c=control('reverb',.8);let tail=0,after=0;
 for(let i=0;i<rate*2;i++){if(i===rate)c.amount=.7;dsp.tick(i===0?.2:0,0,c,i/rate);if(i>rate*.5&&i<rate)tail+=dsp.left**2;if(i>rate&&i<rate*1.1)after+=dsp.left**2;assert.ok(Number.isFinite(dsp.left));}
 assert.ok(tail>1e-9);assert.ok(after>1e-10);
});
test('effect automation is deterministic and switching/bypass stays continuous',()=>{
 const a=new StereoEffects(rate),b=new StereoEffects(rate),c=control('chorus',.8);let previous=0,maxStep=0;
 for(let i=0;i<rate*2;i++){
  if(i===5000)c.effect=effectIds.indexOf('reverb');if(i===10000)c.bypass=1;if(i===15000)c.bypass=0;if(i===20000)c.amount=.3;
  const input=.1*Math.sin(2*Math.PI*200*i/rate);a.tick(input,input,c,i/rate);b.tick(input,input,c,i/rate);
  assert.equal(a.left,b.left);assert.equal(a.right,b.right);maxStep=Math.max(maxStep,Math.abs(a.left-previous));previous=a.left;
 }
 assert.ok(maxStep<.025,`${maxStep}`);
});
test('recordings accept legacy snapshots and validate optional effect settings',()=>{
 const value={visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'lofi',value:.2}]};
 assert.equal(validSnapshot(value),true);
 const next={...value,stems:[{...value.stems[0],effectSettings:{bypass:true,bpm:128,beats:.5}}]};
 assert.equal(validSnapshot(next),true);next.stems[0].effectSettings.bpm=0;assert.equal(validSnapshot(next),false);
 assert.equal(validEffectSettings({bypass:false,bpm:120,beats:3}),false);
});

test('maximum Echo feedback does not accumulate a coherent tone above input level',()=>{
 const {left}=render('delay-pedal',1,3,100,.8);
 let peak=0;for(const x of left)peak=Math.max(peak,Math.abs(x));
 assert.ok(peak<=.81,`${peak}`);
});

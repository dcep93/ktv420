import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePitchChunk, PITCH_STEP } from '../stems/player/visuals/pitchTimeline';
import { ribbonX } from '../stems/player/visuals/ribbonTimeline';
const rate=48000;
function melody(seconds=3) {
  let phase=0;
  return Float32Array.from({length:rate*seconds},(_,i)=>{
    const time=i/rate,hz=time<1?55:time<2?55*2**(2/12):110;
    phase+=2*Math.PI*hz/rate;
    return time>=1.5&&time<1.8?0:.08*(Math.sin(phase)+.5*Math.sin(2*phase));
  });
}
function analyze(channels:Float32Array[],first=0,count=Math.ceil(channels[0].length/rate/PITCH_STEP),startFrame=0) {
  return analyzePitchChunk({channels,sampleRate:rate,first,count,startFrame});
}
test('preloaded source timeline has future notes and centered silence without live playback',()=>{
  const result=analyze([melody()]);
  assert.equal(ribbonX(100,5,1000),250);
  assert.ok(Math.abs(result.pitches[10]-Math.log2(55))<.02);
  assert.ok(Math.abs(result.pitches[21]-Math.log2(55*2**(2/12)))<.02,'melodic step appears by 50ms after onset');
  assert.ok(Math.abs(result.pitches[41]-Math.log2(110))<.02,'octave leap has no causal smoothing lag');
  assert.equal(result.levels[31],0);assert.equal(result.levels[35],0);
  assert.ok(result.levels[37]>.01,'new phrase returns promptly');
});
test('stereo anti-phase does not erase the melody',()=>{
  const data=melody();
  const mono=analyze([data]),stereo=analyze([data,data.map(x=>-x)]);
  assert.deepEqual(stereo.pitches,mono.pitches);assert.deepEqual(stereo.levels,mono.levels);
});
test('independent chunks agree exactly across their boundaries',()=>{
  const data=melody(),all=analyze([data]);
  const first=20,count=20,startFrame=Math.floor((first*PITCH_STEP-.4)*rate);
  const part=analyze([data.slice(startFrame,Math.ceil(((first+count)*PITCH_STEP+.4)*rate))],first,count,startFrame);
  assert.deepEqual(part.pitches,all.pitches.slice(first,first+count));
  assert.deepEqual(part.levels,all.levels.slice(first,first+count));assert.deepEqual(part.hues,all.hues.slice(first,first+count));
});
test('silence stays empty, quiet notes stay measurable, and source analysis is deterministic',()=>{
  const silent=analyze([new Float32Array(rate)]);
  assert.ok(silent.pitches.every(Number.isNaN));assert.ok(silent.levels.every(x=>x===0));
  const data=melody(),quiet=analyze([data.map(x=>x/4)]),loud=analyze([data]);
  assert.ok(Math.abs(quiet.pitches[10]-loud.pitches[10])<.001);
  assert.ok(quiet.hues[10]<quiet.hues[45],'colors distinguish lower and higher spectra');
});

test('low notes bordering rests do not spike into a noisy high register',()=>{
  const samples=Float32Array.from({length:rate*3},(_,i)=>{
    const time=i/rate,within=time%.6;
    if(Math.floor(time/.6)%2===1&&within>.36)return 0;
    const edge=Math.min(1,within/.012,(.6-within)/.012);
    return .04*edge*Math.sin(2*Math.PI*55*time);
  });
  const result=analyze([samples]);
  for(let i=0;i<result.pitches.length;i++)if(result.levels[i]>.004)assert.ok(Math.abs(result.pitches[i]-Math.log2(55))<.15,`spike at ${i*PITCH_STEP}s`);
});

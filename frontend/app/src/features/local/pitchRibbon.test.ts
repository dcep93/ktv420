import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPitchRibbon, pitchCenter, pitchHeight, pitchOpacity, pitchRange } from '../stems/player/visuals/pitchRibbon';
import { PitchEstimator, pitchWindowSize } from '../stems/player/visuals/pitchAnalysis';
import { signalRms } from '../stems/player/visuals/analysis';
import { supportsVisualizer, visualizerOptions } from '../stems/player/visualizerOptions';

test('pitch register tracks tones and chords, rejects silence, and is independent of gain', () => {
  const bins = new Float32Array(1024).fill(-Infinity);
  // 48 kHz / 2048 = 23.4375 Hz per bin.
  bins[8] = -20;
  assert.ok(Math.abs(pitchCenter(bins, 48000)! - 187.5) < 1e-6);
  bins[8] = -40;
  assert.ok(Math.abs(pitchCenter(bins, 48000)! - 187.5) < 1e-6);
  bins[32] = -40;
  assert.ok(Math.abs(pitchCenter(bins, 48000)! - 375) < 1e-6);
  bins.fill(-Infinity); assert.equal(pitchCenter(bins, 48000), null);
  bins.fill(NaN); assert.equal(pitchCenter(bins, 48000), null);
});

test('octaves have equal vertical spacing; quiet active passages stay visible and silence is empty', () => {
  assert.equal(pitchHeight(55), 0); assert.equal(pitchHeight(3520), 1);
  for (const hz of [55, 110, 220, 440, 880]) assert.ok(Math.abs(pitchHeight(hz * 2) - pitchHeight(hz) - 1 / 6) < 1e-10);
  const signal = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * Math.PI / 16) * .2);
  const loud = pitchOpacity(signalRms(signal));
  const quiet = pitchOpacity(signalRms(signal.map(value => value / 2)));
  assert.ok(loud >= quiet && quiet >= .8);
  assert.ok(pitchOpacity(.006)>=.8 && pitchOpacity(.02)>.85);
  assert.ok(pitchOpacity(.003)>.1 && pitchOpacity(.003)<.8);
  assert.equal(pitchOpacity(.001),0);
  assert.equal(pitchOpacity(0), 0); assert.equal(pitchOpacity(NaN), 0); assert.equal(pitchOpacity(1), 1);
});

test('Pitch Ribbon follows Super Time Ribbon and is accepted by replay/settings validation', () => {
  const index = visualizerOptions.findIndex(option => option.value === 'super-time-ribbon');
  assert.equal(visualizerOptions[index + 1].value, 'pitch-ribbon');
  assert.ok(supportsVisualizer('pitch-ribbon'));
});

function tone(hz: number, rate: number, harmonics = [1], gain = .15, offset = .123) {
  return Float32Array.from({length:pitchWindowSize(rate)}, (_,i) => gain * harmonics.reduce((sum,amplitude,h)=>sum+amplitude*Math.sin(2*Math.PI*hz*(h+1)*(i/rate+offset)),0));
}
test('periodicity follows low melodies and changing harmonics, independently of gain',()=>{
  const estimator = new PitchEstimator();
  for(const rate of [44100,48000,96000]) for(const hz of [41.2,55,65.4,73.4,82.4,110,220,440,880,1318.5]) {
    for(const harmonics of [[1],[.25,1,.4],[0,1,.65]]) {
      const actual=estimator.estimate(tone(hz,rate,harmonics),rate);
      assert.ok(actual!==null && Math.abs(12*Math.log2(actual/hz))<.25,`${rate}Hz: expected ${hz}, got ${actual}; ${harmonics}`);
    }
    const loud=estimator.estimate(tone(hz,rate,[1,.5,.2],.2),rate)!;
    const quiet=estimator.estimate(tone(hz,rate,[1,.5,.2],.01),rate)!;
    assert.ok(Math.abs(loud-quiet)<.001);
  }
});
test('periodicity rejects silence, DC and unpitched noise without inventing a note',()=>{
  const estimator=new PitchEstimator(),rate=48000;
  assert.equal(estimator.estimate(new Float32Array(4096),rate),null);
  assert.equal(estimator.estimate(new Float32Array(4096).fill(.1),rate),null);
  let seed=42;
  const noise=Float32Array.from({length:4096},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2**32-.5)*.2;});
  assert.equal(estimator.estimate(noise,rate),null);
});

test('tones above the periodicity range fall back rather than inventing a lower octave',()=>{
  const estimator=new PitchEstimator();
  for(const rate of [44100,48000,96000])for(const hz of [1800,2400])assert.equal(estimator.estimate(tone(hz,rate),rate),null);
});

function preparedTimeline() {
  const count=6000;
  return {pitches:Float32Array.from({length:count},(_,i)=>Math.log2(55)+(Math.floor(i/12)%5)/6),
    levels:Float32Array.from({length:count},(_,i)=>i%48>40?0:.04),hues:new Float32Array(count).fill(35),
    ready:new Uint8Array(count).fill(1),revision:1,failed:false};
}
test('source range is deterministic after seeks and shows two-semitone movement',()=>{
  const timeline=preparedTimeline(),before=pitchRange(timeline,12);
  pitchRange(timeline,180);assert.deepEqual(pitchRange(timeline,12),before);
  assert.ok((2/12)/(before.high-before.low)>.075);
  const next=pitchRange(timeline,12+1/60);
  assert.ok(Math.abs(next.low-before.low)<.01);
});
test('preloaded renderer shows the future while paused, preserves geometry on seek, and offsets pitch',()=>{
  let depth=0,trace:unknown[][]=[];
  const c=new Proxy({}, {get(_t,key){
    if(key==='createLinearGradient')return()=>({addColorStop(...args:unknown[]){trace.push(['color',...args]);}});
    return(...args:unknown[])=>{trace.push([key,...args]);for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a));
      if(key==='save')depth++;if(key==='restore')depth--;};
  },set(){return true;}});
  const canvas={width:1000,height:160,getContext:()=>c} as unknown as HTMLCanvasElement;
  const analyser=new Proxy({}, {get(){throw new Error('No live audio reads allowed');}}) as AnalyserNode;
  const inputs={canvas,analyser,visualizerType:'pitch-ribbon' as const,sampleRate:48000,currentTime:3,duration:300,isPlaying:false,pitchTimeline:preparedTimeline()};
  drawPitchRibbon(inputs);const original=trace;
  assert.ok(trace.some(row=>row[0]==='lineTo'&&Number(row[1])>750),'future contour is drawn before playback');
  assert.ok(trace.some(row=>row[0]==='moveTo'&&row[1]===250&&row[2]===0),'now is one quarter across');
  assert.equal(depth,0);assert.ok(trace.length<1000);
  trace=[];drawPitchRibbon({...inputs,currentTime:170});trace=[];drawPitchRibbon(inputs);
  assert.deepEqual(trace,original,'seeking back recovers identical source geometry');
  trace=[];drawPitchRibbon({...inputs,pitchSemitones:12});assert.notDeepEqual(trace,original);
  trace=[];drawPitchRibbon({...inputs,currentTime:3.25});assert.equal(depth,0);
});

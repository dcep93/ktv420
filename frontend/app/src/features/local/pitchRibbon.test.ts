import test from 'node:test';
import assert from 'node:assert/strict';
import { newPitchHistory, pitchCenter, pitchHeight, pitchOpacity, updatePitchHistory } from '../stems/player/visuals/pitchRibbon';
import { PitchContinuity, PitchEstimator, pitchLevel, pitchWindowSize } from '../stems/player/visuals/pitchAnalysis';
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

test('history samples at a bounded rate, smooths jumps and freezes on pause', () => {
  const state = newPitchHistory(); let samples = 0;
  const measure = () => { samples++; return { hz: 110, rms: .1 }; };
  updatePitchHistory(state, 0, true, measure);
  updatePitchHistory(state, .01, true, measure);
  assert.equal(samples, 1);
  updatePitchHistory(state, .05, true, () => ({ hz: 1760, rms: .2 }));
  const last = state.points.at(-1)!;
  assert.ok(last.pitch > Math.log2(110) && last.pitch < Math.log2(1760));
  const saved = structuredClone(state.points);
  updatePitchHistory(state, .05, false, measure);
  assert.deepEqual(state.points, saved); assert.equal(samples, 1);
  updatePitchHistory(state, .1, true, () => ({ hz: null, rms: 0 }));
  assert.equal(state.points.at(-1)!.opacity, 0);
});

test('seeks, hidden intervals and new tracks do not connect unrelated audio; history stays bounded', () => {
  const state = newPitchHistory(), measure = () => ({ hz: 440, rms: .1 });
  for (let i = 0; i < 6000; i++) updatePitchHistory(state, i * .05, true, measure);
  assert.ok(state.points.length <= 402);
  assert.ok(state.points[0].time >= state.lastTime - 20.1);
  updatePitchHistory(state, 10, false, measure); assert.equal(state.points.length, 0);
  updatePitchHistory(state, 10, true, measure); assert.equal(state.points.length, 1);
  updatePitchHistory(state, 30, true, measure); assert.equal(state.points.length, 1);
  assert.equal(newPitchHistory().points.length, 0);
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

test('melodic steps remain visible without flattening or a jumpy vertical scale',()=>{
  const state=newPitchHistory();
  for(let i=0;i<20;i++)updatePitchHistory(state,i*.05,true,()=>({hz:55,rms:.02,hue:25}));
  const before={...state.range!};
  for(let i=20;i<23;i++)updatePitchHistory(state,i*.05,true,()=>({hz:55*2**(2/12),rms:.02,hue:35}));
  const point=state.points.at(-1)!;
  assert.ok(Math.abs(point.pitch-Math.log2(55*2**(2/12)))<.01,'two-semitone change settles within 150ms');
  const movement=(point.pitch-state.points[19].pitch)/(state.range!.high-state.range!.low);
  assert.ok(movement>.075,'two semitones span at least 7.5% of panel height');
  assert.ok(state.range!.high-state.range!.low>=2-1e-10);
  assert.ok(Math.abs(state.range!.low-before.low)<.03,'range drifts gently');
  assert.equal(point.hue,35,'history preserves the shared ribbon hue for each sample');
  updatePitchHistory(state,1.15,true,()=>({hz:55,rms:0,hue:35}));
  assert.equal(state.points.at(-1)!.opacity,0,'silence breaks even a confident pitch');
  updatePitchHistory(state,1.2,true,()=>({hz:110,rms:.02,hue:70}));
  assert.equal(state.points.at(-1)!.pitch,Math.log2(110),'new phrase does not glide through silence');
});

test('brief pitch uncertainty holds the note but sustained unpitched audio can use the fallback',()=>{
  const tracker=new PitchContinuity();
  assert.equal(tracker.resolve(55,1),55);
  assert.equal(tracker.resolve(null,1.1),55);
  assert.equal(tracker.resolve(null,1.3),null);
  assert.equal(tracker.resolve(65.4,1.35),65.4);
  tracker.reset();assert.equal(tracker.resolve(null,1.35),null);
});
test('silence opacity reads the recent waveform instead of smearing the pitch window into a gap',()=>{
  const samples=tone(55,48000);
  samples.fill(0,samples.length-960);
  assert.ok(signalRms(samples)>.01);
  assert.equal(pitchLevel(samples,48000),0);
});

test('pitch continuity rejects isolated register spikes but accepts a sustained leap',()=>{
  const tracker=new PitchContinuity();
  assert.equal(tracker.resolve(55,0),55);
  tracker.gap();
  assert.equal(tracker.resolve(null,.3),55,'new attack can reuse the previous tonal estimate');
  assert.equal(tracker.resolve(110,.35),55,'one-frame octave error does not draw a spike');
  assert.equal(tracker.resolve(55,.4),55);
  assert.equal(tracker.resolve(110,.45),55);
  assert.equal(tracker.resolve(110,.5),110,'intentional leaps remain visible after one confirmation');
});

test('tones above the periodicity range fall back rather than inventing a lower octave',()=>{
  const estimator=new PitchEstimator();
  for(const rate of [44100,48000,96000])for(const hz of [1800,2400])assert.equal(estimator.estimate(tone(hz,rate),rate),null);
});

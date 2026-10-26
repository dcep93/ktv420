import test from 'node:test';
import assert from 'node:assert/strict';
import { newPitchHistory, pitchCenter, pitchHeight, pitchOpacity, updatePitchHistory } from '../stems/player/visuals/pitchRibbon';
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

test('octaves have equal vertical spacing; waveform level sets opacity with a silent floor', () => {
  assert.equal(pitchHeight(55), 0); assert.equal(pitchHeight(3520), 1);
  for (const hz of [55, 110, 220, 440, 880]) assert.ok(Math.abs(pitchHeight(hz * 2) - pitchHeight(hz) - 1 / 6) < 1e-10);
  const signal = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * Math.PI / 16) * .2);
  const loud = pitchOpacity(signalRms(signal));
  const quiet = pitchOpacity(signalRms(signal.map(value => value / 2)));
  assert.ok(Math.abs(loud / 2 - quiet) < 1e-6);
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
  assert.ok(last.pitch > pitchHeight(110) && last.pitch < pitchHeight(1760));
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

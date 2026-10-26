import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChordSamples, centeredWindow, smoothTimeline, type AudioSamples } from '../stems/player/harmony/chords';
import { HarmonicSpectrum, estimateTuning } from '../stems/player/harmony/spectrum';
import { analyzeChordTimeline, chordAtTime } from '../stems/player/chordAnalyzer';

function synth(notes: number[], { rate = 16000, seconds = 1.6, cents = 0, harmonics = 1, gain = .1, stereo = false, weights = notes.map(() => 1) } = {}): AudioSamples {
  const data = Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => notes.reduce((sum, midi, n) => {
    const frequency = 440 * 2 ** ((midi - 69 + cents / 100) / 12);
    for (let harmonic = 1; harmonic <= harmonics && frequency * harmonic < rate / 2; harmonic++) sum += gain * weights[n] / harmonic * Math.sin(2 * Math.PI * frequency * harmonic * i / rate + n * .37);
    return sum;
  }, 0));
  const opposite = stereo ? data.map(v => -v) : data;
  return { sampleRate: rate, length: data.length, numberOfChannels: stereo ? 2 : 1, getChannelData: c => c ? opposite : data };
}
const at = (buffer: AudioSamples, time = .8) => chordAtTime(analyzeChordSamples(buffer), time)?.chord;
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

test('major and minor chords are recognized in every key, including inversions', () => {
  for (let root = 0; root < 12; root++) for (const third of [3, 4]) {
    const name = names[root] + (third === 3 ? 'm' : '');
    assert.equal(at(synth([48 + root, 48 + root + third, 55 + root])), name);
    assert.equal(at(synth([48 + root + third, 55 + root, 60 + root])), name);
  }
});

test('sevenths and ninths require their defining notes; add9 is not maj9', () => {
  for (const [notes, name] of [
    [[48, 52, 55, 58], 'C7'], [[48, 52, 55, 59], 'Cmaj7'], [[45, 48, 52, 55], 'Am7'],
    [[48, 50, 52, 55], 'Cadd9'], [[48, 50, 52, 55, 59], 'Cmaj9'], [[48, 55], 'C5'],
  ] as const) assert.equal(at(synth([...notes])), name);
});

test('detuning, harmonic overtones, unequal note levels and quiet gain retain the chord', () => {
  for (const cents of [-35, 0, 32]) for (const gain of [.003, .1]) {
    assert.equal(at(synth([48, 52, 55], { cents, gain, harmonics: 6 })), 'C');
  }
  assert.equal(at(synth([48, 52, 55], { weights: [1, .3, .7] })), 'C');
  const buffer = synth([48, 52, 55], { cents: 32, harmonics: 5 }), spectrum = new HarmonicSpectrum(buffer.sampleRate);
  const tuning = estimateTuning([spectrum.analyze(centeredWindow(buffer, 12000, spectrum.size))]);
  assert.ok(Math.abs(tuning - 32) < 4, `estimated ${tuning} cents`);
});

test('native-rate stereo power preserves opposite-polarity chords without aliasing', () => {
  for (const rate of [11025, 44100, 48000, 96000]) {
    assert.equal(at(synth([45, 48, 52], { rate, stereo: true, harmonics: 4 })), 'Am');
  }
  const buffer = synth([], { rate: 48000 });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = .3 * Math.sin(2 * Math.PI * 11286 * i / 48000);
  assert.equal(at(buffer), 'Unclear', 'a high tone must not alias into a false bass/chord');
});

test('silence, DC, noise and a single rich note do not invent chords', () => {
  assert.equal(at(synth([])), 'Unclear');
  for (const note of [28, 40, 48, 69]) assert.equal(at(synth([note], { harmonics: 6 })), 'Unclear');
  const buffer = synth([]), samples = buffer.getChannelData(0); samples.fill(.3);
  assert.equal(at(buffer), 'Unclear');
  let seed = 17;
  for (let i = 0; i < samples.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; samples[i] = (seed / 4294967296 - .5) * .2; }
  assert.equal(at(buffer), 'Unclear');
});

test('centered windows keep changes near their actual time and do not fill silence', () => {
  const segments = [synth([48, 52, 55], { seconds: 2 }), synth([], { seconds: 1 }), synth([45, 48, 52], { seconds: 2 })];
  const samples = new Float32Array(16000 * 5); let offset = 0;
  for (const segment of segments) { samples.set(segment.getChannelData(0), offset); offset += segment.length; }
  const timeline = analyzeChordSamples({ sampleRate: 16000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples });
  assert.equal(chordAtTime(timeline, 1)?.chord, 'C'); assert.equal(chordAtTime(timeline, 2.5)?.chord, 'Unclear');
  assert.equal(chordAtTime(timeline, 3.6)?.chord, 'Am');
  const change = timeline.find(frame => frame.chord === 'Am');
  assert.ok(change && change.time >= 2.8 && change.time <= 3.4, JSON.stringify(timeline));
  assert.equal(chordAtTime(timeline, -1), undefined);
  assert.deepEqual(smoothTimeline([{ time: 0, chord: 'C', confidence: 1 }, { time: .2, chord: 'Unclear', confidence: 0 }, { time: .4, chord: 'C', confidence: 1 }]).map(v => v.chord), ['C', 'Unclear', 'C']);
});

test('a mixed transition window does not insert a phantom extended chord', () => {
  const first = synth([48, 52, 55], { seconds: 2, rate: 44100, harmonics: 5 });
  const second = synth([45, 48, 52], { seconds: 2, rate: 44100, harmonics: 5 });
  const samples = new Float32Array(first.length + second.length);
  samples.set(first.getChannelData(0)); samples.set(second.getChannelData(0), first.length);
  const timeline = analyzeChordSamples({ sampleRate: 44100, length: samples.length, numberOfChannels: 1, getChannelData: () => samples });
  assert.deepEqual(timeline.map(frame => frame.chord), ['C', 'Am']);
  assert.ok(Math.abs(timeline[1].time - 2) <= .2);
});

test('wide voicings and percussion preserve the underlying harmony', () => {
  const source = synth([36, 48, 55, 64], { harmonics: 5 });
  const samples = source.getChannelData(0); let seed = 29;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const decay = Math.exp(-(i % 4000) / 300);
    samples[i] += (seed / 4294967296 - .5) * .25 * decay;
  }
  assert.equal(at(source), 'C');
});

test('a pre-canceled scan never starts worker processing', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeChordTimeline(synth([48, 52, 55]) as AudioBuffer, { signal: controller.signal }), { name: 'AbortError' });
});

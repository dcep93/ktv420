import { estimateTuning, HarmonicSpectrum, pitchClasses, type SpectrumFrame } from './spectrum';

export type ChordSnapshot = { time: number; chord: string; confidence: number };
const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const templates = [
  { suffix: '', intervals: [0, 4, 7] }, { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] }, { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] }, { suffix: 'add9', intervals: [0, 2, 4, 7] },
  { suffix: 'm(add9)', intervals: [0, 2, 3, 7] }, { suffix: 'maj9', intervals: [0, 2, 4, 7, 11] },
  { suffix: 'm9', intervals: [0, 2, 3, 7, 10] }, { suffix: '9', intervals: [0, 2, 4, 7, 10] },
  { suffix: 'sus2', intervals: [0, 2, 7] }, { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: '5', intervals: [0, 7] }, { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
];
const unclear = (time: number): ChordSnapshot => ({ time, chord: 'Unclear', confidence: 0 });

export function classifyChord(frame: SpectrumFrame, tuning: number, time: number): ChordSnapshot {
  if (frame.rms < 1e-4 || frame.flatness > .45) return unclear(time);
  const { chroma, bass } = pitchClasses(frame, tuning);
  const norm = Math.hypot(...chroma), total = chroma.reduce((a, b) => a + b, 0), bassTotal = bass.reduce((a, b) => a + b, 0);
  if (norm < 1e-10 || chroma.filter(v => v > .18).length < 2) return unclear(time);
  let best = { chord: 'Unclear', score: 0, coverage: 0, cosine: 0 }, runner = 0;
  for (let root = 0; root < 12; root++) for (const template of templates) {
    if (template.suffix === '5' && (chroma[(root + 3) % 12] > .18 || chroma[(root + 4) % 12] > .18)) continue;
    const values = template.intervals.map(interval => chroma[(root + interval) % 12]);
    // A third/seventh/ninth must actually be present to name it.
    if (values.some(v => v < .18)) continue;
    const sum = values.reduce((a, b) => a + b, 0), coverage = sum / total;
    const cosine = sum / (norm * Math.sqrt(values.length));
    const score = .75 * cosine + .25 * coverage - Math.max(0, values.length - 3) * .012 + (bassTotal ? bass[root] / bassTotal * .025 : 0);
    if (score > best.score) { runner = best.score; best = { chord: notes[root] + template.suffix, score, coverage, cosine }; }
    else runner = Math.max(runner, score);
  }
  if (best.coverage < .72 || best.cosine < .78) return unclear(time);
  const margin = best.score - runner;
  if (margin < .008) return unclear(time);
  // Relative evidence, not a probability of correctness.
  const confidence = Math.min(1, best.cosine * .55 + best.coverage * .25 + Math.min(1, margin / .12) * .2);
  return { time, chord: best.chord, confidence };
}

/** Remove isolated label flickers, but never paint a chord over a no-chord frame. */
export function smoothTimeline(frames: ChordSnapshot[]): ChordSnapshot[] {
  const result: ChordSnapshot[] = [];
  for (let i = 0; i < frames.length; i++) {
    let frame = frames[i];
    if (frame.chord !== 'Unclear' && i > 0 && i + 1 < frames.length && frames[i - 1].chord === frames[i + 1].chord) {
      frame = { ...frame, chord: frames[i - 1].chord, confidence: Math.min(frames[i - 1].confidence, frames[i + 1].confidence) };
    } else if (frame.chord !== 'Unclear' && frame.confidence < .9 && i > 0 && i + 1 < frames.length &&
      frames[i - 1].chord !== frame.chord && frames[i + 1].chord !== frame.chord && frames[i + 1].confidence > .9) {
      // A centered window across a change can contain both chords and suggest a
      // spurious seventh/ninth for one hop. Prefer the clearly established arrival.
      frame = { ...frame, chord: frames[i + 1].chord, confidence: frames[i + 1].confidence };
    }
    if (!result.length || result[result.length - 1].chord !== frame.chord) result.push(frame);
  }
  return result;
}

export type AudioSamples = { sampleRate: number; length: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };
export function centeredWindow(buffer: AudioSamples, center: number, size: number): Float32Array[] {
  const start = Math.round(center) - Math.floor(size / 2), first = Math.max(0, start), last = Math.min(buffer.length, start + size);
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
    const samples = new Float32Array(size);
    if (last > first) samples.set(buffer.getChannelData(channel).subarray(first, last), first - start);
    return samples;
  });
}
export function tuningCenters(length: number): number[] { return Array.from({ length: 12 }, (_, i) => Math.round(length * (i + .5) / 12)); }

/** Reference path for signal tests; production invokes the same DSP inside a worker. */
export function analyzeChordSamples(buffer: AudioSamples): ChordSnapshot[] {
  const spectrum = new HarmonicSpectrum(buffer.sampleRate);
  const tuning = estimateTuning(tuningCenters(buffer.length).map(center => spectrum.analyze(centeredWindow(buffer, center, spectrum.size))));
  const frames: ChordSnapshot[] = [], hop = Math.round(buffer.sampleRate * .2);
  for (let center = 0; center < buffer.length; center += hop) frames.push(classifyChord(spectrum.analyze(centeredWindow(buffer, center, spectrum.size)), tuning, center / buffer.sampleRate));
  return smoothTimeline(frames);
}

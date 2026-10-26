import { fft, getHannWindow } from '../../../local/inference/fft';

export type Peak = { frequency: number; magnitude: number };
export type SpectrumFrame = { peaks: Peak[]; rms: number; flatness: number };
export const frameSizeFor = (rate: number) => 2 ** Math.ceil(Math.log2(rate * .5));

/** Native-rate spectra avoid decimation aliases; channel powers cannot phase-cancel. */
export class HarmonicSpectrum {
  readonly size: number;
  readonly sampleRate: number;
  private input: Float32Array;
  private real: Float32Array;
  private imaginary: Float32Array;
  private power: Float64Array;
  private window: Float32Array;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.size = frameSizeFor(sampleRate);
    this.input = new Float32Array(this.size); this.real = new Float32Array(this.size);
    this.imaginary = new Float32Array(this.size); this.power = new Float64Array(this.size / 2);
    this.window = getHannWindow(this.size);
  }
  analyze(channels: Float32Array[]): SpectrumFrame {
    this.power.fill(0); let squares = 0;
    for (const samples of channels) {
      let mean = 0;
      for (const sample of samples) mean += Number.isFinite(sample) ? sample : 0;
      mean /= Math.max(1, samples.length);
      for (let i = 0; i < this.size; i++) {
        const sample = Number.isFinite(samples[i]) ? samples[i] - mean : 0;
        squares += sample * sample; this.input[i] = sample * this.window[i];
      }
      fft(this.real, this.imaginary, this.input, this.size);
      for (let i = 0; i < this.power.length; i++) this.power[i] += this.real[i] ** 2 + this.imaginary[i] ** 2;
    }
    const low = Math.max(2, Math.ceil(32.7 * this.size / this.sampleRate));
    const high = Math.min(this.power.length - 2, Math.floor(5000 * this.size / this.sampleRate));
    let total = 0, logarithms = 0, maximum = 0;
    for (let i = low; i <= high; i++) {
      const value = this.power[i]; total += value; logarithms += Math.log(value + 1e-20); maximum = Math.max(maximum, value);
    }
    const count = high - low + 1;
    const flatness = total > 1e-15 ? Math.exp(logarithms / count) / (total / count) : 1;
    const peaks: Peak[] = [];
    for (let i = low; i <= high; i++) {
      const value = this.power[i];
      if (value < maximum * .0004 || value <= this.power[i - 1] || value < this.power[i + 1]) continue;
      // Interpolate log-power peaks for tuning accuracy between FFT bins.
      const a = Math.log(this.power[i - 1] + 1e-20), b = Math.log(value + 1e-20), c = Math.log(this.power[i + 1] + 1e-20);
      const offset = Math.max(-.5, Math.min(.5, .5 * (a - c) / (a - 2 * b + c)));
      peaks.push({ frequency: (i + offset) * this.sampleRate / this.size, magnitude: Math.sqrt(Math.exp(b - .25 * (a - c) * offset)) });
    }
    return { peaks, rms: Math.sqrt(squares / Math.max(1, this.size * channels.length)), flatness };
  }
}

/** Modal pitch deviation rejects strong detuned overtones rather than averaging them in. */
export function estimateTuning(frames: SpectrumFrame[]): number {
  const observations: { cents: number; weight: number }[] = [];
  const histogram = new Float64Array(100);
  for (const frame of frames) {
    if (frame.rms < 1e-4 || frame.flatness > .45) continue;
    const strongest = [...frame.peaks].filter(p => p.frequency > 100 && p.frequency < 2500).sort((a, b) => b.magnitude - a.magnitude).slice(0, 12);
    const maximum = strongest[0]?.magnitude ?? 1;
    for (const peak of strongest) {
      const midi = 69 + 12 * Math.log2(peak.frequency / 440);
      const cents = (midi - Math.round(midi)) * 100, weight = (peak.magnitude / maximum) ** 2;
      observations.push({ cents, weight });
      for (let bin = 0; bin < 100; bin++) {
        const delta = ((cents - (bin - 50) + 150) % 100) - 50;
        histogram[bin] += weight * Math.exp(-.5 * (delta / 3) ** 2);
      }
    }
  }
  if (!observations.length) return 0;
  let mode = 0; for (let i = 1; i < 100; i++) if (histogram[i] > histogram[mode]) mode = i;
  const center = mode - 50; let sum = 0, weight = 0;
  for (const observation of observations) {
    const delta = ((observation.cents - center + 150) % 100) - 50;
    if (Math.abs(delta) < 9) { sum += (center + delta) * observation.weight; weight += observation.weight; }
  }
  return weight ? ((sum / weight + 150) % 100) - 50 : 0;
}

export function pitchClasses(frame: SpectrumFrame, tuningCents: number) {
  const chroma = new Float64Array(12), bass = new Float64Array(12);
  const fundamentals: Peak[] = [];
  for (const peak of frame.peaks) {
    let predicted = 0;
    for (const lower of fundamentals) {
      const ratio = peak.frequency / lower.frequency, harmonic = Math.round(ratio);
      if (harmonic >= 2 && harmonic <= 8 && Math.abs(1200 * Math.log2(ratio / harmonic)) < 28) {
        predicted = Math.max(predicted, lower.magnitude / harmonic);
      }
    }
    const magnitude = Math.max(0, peak.magnitude - predicted);
    fundamentals.push({ frequency: peak.frequency, magnitude });
    const midi = 69 + 12 * Math.log2(peak.frequency / 440) - tuningCents / 100;
    const note = Math.round(midi), distance = Math.abs(midi - note);
    if (note < 28 || note > 95 || distance > .4) continue;
    const weight = magnitude * Math.exp(-.5 * (distance / .2) ** 2) / Math.sqrt(Math.max(1, peak.frequency / 440));
    chroma[(note % 12 + 12) % 12] += weight;
    if (peak.frequency < 240) bass[(note % 12 + 12) % 12] += weight;
  }
  const maximum = Math.max(...chroma);
  // Remove weak residual overtones, without spreading energy to adjacent notes.
  for (let i = 0; i < 12; i++) chroma[i] = maximum ? Math.max(0, chroma[i] / maximum - .06) / .94 : 0;
  return { chroma, bass };
}

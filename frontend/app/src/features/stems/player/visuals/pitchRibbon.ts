import type { VisualizerInputs } from '../visualizers';
import { analysisBytes, waveform } from './analysis';
import { beginVisualizer } from './canvas';
import { PitchContinuity, PitchEstimator, pitchLevel } from './pitchAnalysis';
import { smoothRibbonColor } from './timeRibbon';

const WINDOW = 20, STEP = .05, LOW = 55, HIGH = 3520;
const MAX_POINTS = Math.ceil(WINDOW / STEP) + 2;
const spectra = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
const estimators = new WeakMap<AnalyserNode, PitchEstimator>();
const histories = new WeakMap<HTMLCanvasElement, PitchHistory>();
type Point = { time: number; pitch: number; opacity: number; hue: number };
export type PitchRange = { low: number; high: number };
export type PitchHistory = { points: Point[]; lastTime: number; sampledAt: number; range: PitchRange | null; continuity: PitchContinuity };
export const newPitchHistory = (): PitchHistory => ({ points: [], lastTime: -1, sampledAt: -1, range: null, continuity: new PitchContinuity() });

/** Approximate perceived register, not note transcription: power-weighted log frequency
 * remains meaningful for chords/noise where a single fundamental is ambiguous. */
export function pitchCenter(spectrum: Float32Array, sampleRate: number): number | null {
  let weight = 0, total = 0;
  const resolution = sampleRate / (spectrum.length * 2);
  for (let bin = Math.max(1, Math.ceil(LOW / resolution)); bin < spectrum.length; bin++) {
    const frequency = bin * resolution;
    if (frequency > HIGH) break;
    const db = spectrum[bin];
    if (!Number.isFinite(db) || db < -90) continue;
    const power = 10 ** (db / 10);
    weight += power;
    total += Math.log2(frequency) * power;
  }
  return weight > 1e-9 ? 2 ** (total / weight) : null;
}

export function pitchHeight(hz: number, range: PitchRange = {low: Math.log2(LOW), high: Math.log2(HIGH)}) {
  return Math.max(0, Math.min(1, (Math.log2(hz) - range.low) / (range.high - range.low)));
}
export function pitchOpacity(rms: number) {
  if (!Number.isFinite(rms) || rms <= .0015) return 0;
  // Loudness mostly marks rests: ordinary quiet notes must not disappear.
  const gate = Math.min(1, (rms - .0015) / .0045);
  return .8 * gate * gate * (3 - 2 * gate) + .2 * Math.max(0, Math.min(1, Math.log2(rms / .006) / 5));
}

function fitRange(state: PitchHistory, time: number, dt: number) {
  const pitches = state.points.filter(point => point.opacity >= .5 && time - point.time <= 8).map(point => point.pitch).sort((a,b) => a-b);
  if (!pitches.length) return;
  const low = pitches[Math.floor((pitches.length - 1) * .05)], high = pitches[Math.ceil((pitches.length - 1) * .95)];
  const span = Math.max(2, high - low + .7), center = (low + high) / 2;
  const target = {low: center - span / 2, high: center + span / 2};
  if (!state.range) { state.range = target; return; }
  const latest = state.points.at(-1)!.pitch;
  // Open the view sooner when a phrase leaves it; otherwise drift very gently.
  const response = latest < state.range.low + .1 || latest > state.range.high - .1 ? .4 : 2.5;
  const blend = 1 - Math.exp(-dt / response);
  state.range.low += (target.low - state.range.low) * blend;
  state.range.high += (target.high - state.range.high) * blend;
}

export function updatePitchHistory(state: PitchHistory, time: number, playing: boolean,
  measure: () => { hz: number | null; rms: number; hue?: number }) {
  if (!Number.isFinite(time)) return;
  // No line across seeks or unobserved audio (hidden canvas/background tab).
  if (time < state.lastTime || time - state.lastTime > .4) {
    state.points.length = 0; state.sampledAt = -1; state.range = null; state.continuity.reset();
  }
  state.lastTime = time;
  if (!playing || time - state.sampledAt < STEP - 1e-6) return;
  const { hz, rms, hue = 325 } = measure();
  const previous = state.points.at(-1);
  const validPitch = hz !== null && Number.isFinite(hz) && hz > 0;
  const opacity = validPitch ? pitchOpacity(rms) : 0;
  const target = validPitch ? Math.log2(hz) : previous?.pitch ?? Math.log2(220);
  const dt = previous ? time - previous.time : STEP;
  const pitch = previous && previous.opacity > 0 && opacity > 0
    ? previous.pitch + (target - previous.pitch) * (1 - Math.exp(-dt / .045)) : target;
  const level = opacity === 0 ? 0 : previous && previous.opacity > 0
    ? previous.opacity + (opacity - previous.opacity) * (1 - Math.exp(-dt / .035)) : opacity;
  state.points.push({ time, pitch, opacity: level, hue });
  state.sampledAt = time;
  while (state.points.length > MAX_POINTS || (state.points.length > 1 && state.points[1].time < time - WINDOW)) state.points.shift();
  fitRange(state, time, dt);
}

export function resetPitchRibbon(canvas: HTMLCanvasElement) { histories.delete(canvas); }

export function drawPitchRibbon({ canvas, analyser, currentTime, isPlaying, sampleRate }: VisualizerInputs) {
  const view = beginVisualizer(canvas); if (!view) return;
  const { context: c, width: w, height: h, background } = view;
  try {
    let history = histories.get(canvas);
    if (!history) { history = newPitchHistory(); histories.set(canvas, history); }
    const colors = analysisBytes(analyser, analyser.frequencyBinCount);
    analyser.getByteFrequencyData(colors);
    const hue = smoothRibbonColor(canvas, colors, sampleRate, currentTime, isPlaying);
    updatePitchHistory(history, currentTime, isPlaying, () => {
      const samples = waveform(analyser), rms = pitchLevel(samples, sampleRate);
      if (!pitchOpacity(rms)) { history.continuity.gap(); return {hz: null, rms, hue}; }
      let estimator = estimators.get(analyser);
      if (!estimator) { estimator = new PitchEstimator(); estimators.set(analyser, estimator); }
      const fundamental = history.continuity.resolve(estimator.estimate(samples, sampleRate), currentTime);
      if (fundamental !== null) return {hz: fundamental, rms, hue};
      let spectrum = spectra.get(analyser);
      if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
        spectrum = new Float32Array(analyser.frequencyBinCount); spectra.set(analyser, spectrum);
      }
      analyser.getFloatFrequencyData(spectrum);
      return { hz: pitchCenter(spectrum, sampleRate), rms, hue };
    });
    c.fillStyle = background; c.fillRect(0, 0, w, h);
    const margin = Math.min(16, h / 8), plotHeight = h - margin * 2;
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.045)';
    c.beginPath();
    const range = history.range ?? {low: Math.log2(110), high: Math.log2(440)};
    for (let octave = Math.ceil(range.low); octave < range.high; octave++) {
      const y = margin + plotHeight * (range.high - octave) / (range.high - range.low);
      c.moveTo(0, y); c.lineTo(w, y);
    }
    c.stroke();
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
    const x = (time: number) => (1 - (currentTime - time) / WINDOW) * (w - 4);
    const y = (pitch: number) => margin + (range.high - pitch) / (range.high - range.low) * plotHeight;
    const points = history.points;
    if (points.length < 2) return;
    // One stroke avoids bright beads where translucent segment caps overlap.
    const gradient = c.createLinearGradient(0, 0, w, 0);
    for (const point of points) {
      const stop = Math.max(0, Math.min(1, x(point.time) / w));
      gradient.addColorStop(stop, `hsla(${point.hue},75%,65%,${point.opacity})`);
    }
    c.strokeStyle = gradient; c.beginPath();
    let connected = false;
    for (const point of points) {
      // Silence breaks the line rather than suggesting a low pitch.
      if (!point.opacity) { connected = false; continue; }
      if (connected) c.lineTo(x(point.time), y(point.pitch));
      else c.moveTo(x(point.time), y(point.pitch));
      connected = true;
    }
    c.stroke();
  } finally { c.restore(); }
}

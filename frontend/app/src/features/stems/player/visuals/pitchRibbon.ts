import type { VisualizerInputs } from '../visualizers';
import { signalRms, waveform } from './analysis';
import { beginVisualizer } from './canvas';

const WINDOW = 20, STEP = .05, LOW = 55, HIGH = 3520;
const MAX_POINTS = Math.ceil(WINDOW / STEP) + 2;
const spectra = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
const histories = new WeakMap<HTMLCanvasElement, PitchHistory>();
type Point = { time: number; pitch: number; opacity: number };
export type PitchHistory = { points: Point[]; lastTime: number; sampledAt: number };
export const newPitchHistory = (): PitchHistory => ({ points: [], lastTime: -1, sampledAt: -1 });

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

export function pitchHeight(hz: number) {
  return Math.max(0, Math.min(1, Math.log2(hz / LOW) / Math.log2(HIGH / LOW)));
}
export function pitchOpacity(rms: number) {
  return Number.isFinite(rms) && rms > .001 ? Math.min(1, rms * 4) : 0;
}

export function updatePitchHistory(state: PitchHistory, time: number, playing: boolean,
  measure: () => { hz: number | null; rms: number }) {
  if (!Number.isFinite(time)) return;
  // No line across seeks or unobserved audio (hidden canvas/background tab).
  if (time < state.lastTime || time - state.lastTime > .4) {
    state.points.length = 0; state.sampledAt = -1;
  }
  state.lastTime = time;
  if (!playing || time - state.sampledAt < STEP - 1e-6) return;
  const { hz, rms } = measure();
  const previous = state.points.at(-1);
  const opacity = hz === null ? 0 : pitchOpacity(rms);
  const target = hz === null ? previous?.pitch ?? .5 : pitchHeight(hz);
  const dt = previous ? time - previous.time : STEP;
  const pitch = previous && previous.opacity > 0 && opacity > 0
    ? previous.pitch + (target - previous.pitch) * (1 - Math.exp(-dt / .18)) : target;
  const level = opacity === 0 ? 0 : previous && previous.opacity > 0
    ? previous.opacity + (opacity - previous.opacity) * (1 - Math.exp(-dt / .08)) : opacity;
  state.points.push({ time, pitch, opacity: level });
  state.sampledAt = time;
  while (state.points.length > MAX_POINTS || (state.points.length > 1 && state.points[1].time < time - WINDOW)) state.points.shift();
}

export function resetPitchRibbon(canvas: HTMLCanvasElement) { histories.delete(canvas); }

export function drawPitchRibbon({ canvas, analyser, currentTime, isPlaying, sampleRate }: VisualizerInputs) {
  const view = beginVisualizer(canvas); if (!view) return;
  const { context: c, width: w, height: h, background } = view;
  try {
    let history = histories.get(canvas);
    if (!history) { history = newPitchHistory(); histories.set(canvas, history); }
    updatePitchHistory(history, currentTime, isPlaying, () => {
      let spectrum = spectra.get(analyser);
      if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
        spectrum = new Float32Array(analyser.frequencyBinCount); spectra.set(analyser, spectrum);
      }
      analyser.getFloatFrequencyData(spectrum);
      return { hz: pitchCenter(spectrum, sampleRate), rms: signalRms(waveform(analyser)) };
    });
    c.fillStyle = background; c.fillRect(0, 0, w, h);
    const margin = Math.min(16, h / 8), plotHeight = h - margin * 2;
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.045)';
    c.beginPath();
    for (let octave = 1; octave < 6; octave++) {
      const y = margin + plotHeight * octave / 6;
      c.moveTo(0, y); c.lineTo(w, y);
    }
    c.stroke();
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
    const x = (time: number) => (1 - (currentTime - time) / WINDOW) * (w - 4);
    const y = (pitch: number) => margin + (1 - pitch) * plotHeight;
    const points = history.points;
    if (points.length < 2) return;
    // One stroke avoids bright beads where translucent segment caps overlap.
    const gradient = c.createLinearGradient(0, 0, w, 0);
    for (const point of points) {
      const stop = Math.max(0, Math.min(1, x(point.time) / w));
      gradient.addColorStop(stop, `rgba(255,119,200,${point.opacity})`);
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

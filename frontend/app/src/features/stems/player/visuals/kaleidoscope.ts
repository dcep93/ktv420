import type { VisualizerInputs } from '../visualizers';
import { analysisBytes, frequencyBin } from './analysis';
import { beginVisualizer } from './canvas';
import { createKaleidoscopeMotion, kaleidoscopePose, updateKaleidoscopeMotion } from './kaleidoscopeMotion';

const IMAGE_SRC = new URL('../../../../assets/kaleidoscope.svg', import.meta.url).href;
let image: HTMLImageElement | undefined;
const states = new WeakMap<HTMLCanvasElement, { motion: ReturnType<typeof createKaleidoscopeMotion>; pattern: CanvasPattern | null }>();
export function resetKaleidoscope(canvas: HTMLCanvasElement) { states.delete(canvas); }

export function drawKaleidoscope({ canvas, analyser, currentTime, isPlaying, effectiveVolume = 1, sampleRate }: VisualizerInputs) {
  const view = beginVisualizer(canvas); if (!view) return;
  const { context: c, width, height, background } = view;
  try {
    c.fillStyle = background; c.fillRect(0, 0, width, height);
    if (!image) { image = new Image(); image.src = IMAGE_SRC; }
    let state = states.get(canvas);
    if (!state) { state = { motion: createKaleidoscopeMotion(), pattern: null }; states.set(canvas, state); }
    if (!state.pattern && image.complete && image.naturalWidth > 0) state.pattern = c.createPattern(image, 'repeat');
    let energy = 0, bass = 0;
    if (isPlaying && effectiveVolume > 0) {
      // This analyser is after the stem fader/effects: do not apply volume twice.
      const samples = analysisBytes(analyser, analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      for (let i = 0; i < samples.length; i++) energy += ((samples[i] - 128) / 128) ** 2;
      energy = Math.min(1, Math.sqrt(energy / samples.length) * 3.5);
      const frequencies = analysisBytes(analyser, analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frequencies);
      const lo = frequencyBin(35, sampleRate, analyser.fftSize), hi = frequencyBin(250, sampleRate, analyser.fftSize);
      for (let i = lo; i <= hi; i++) bass += frequencies[i] / 255;
      bass /= Math.max(1, hi - lo + 1);
    }
    updateKaleidoscopeMotion(state.motion, currentTime, isPlaying, effectiveVolume > 0, energy, bass);
    if (!state.pattern || !image.width || !image.height) return;
    const pose = kaleidoscopePose(state.motion), radius = Math.hypot(width, height) / 2 + 2;
    // Scale the optics to the viewport, not the motion speed. Keep motif detail
    // comparable to the existing artwork in both a strip and an expanded panel.
    const scale = 1.5 * Math.max(600, radius) / Math.min(image.width, image.height);
    const slices = 24, step = Math.PI * 2 / slices;
    c.fillStyle = state.pattern;
    for (let i = 0; i < slices; i++) {
      c.save(); c.translate(width / 2, height / 2); c.rotate(i * step);
      c.beginPath(); c.moveTo(-.5, -.5); c.arc(0, 0, radius, step * -.505, step * .505); c.closePath();
      c.rotate(Math.PI / 2); c.scale(scale * (i % 2 ? -1 : 1), scale);
      c.translate(pose.x - image.width / 2, pose.y); c.rotate(pose.rotation); c.scale(pose.scale, pose.scale); c.fill(); c.restore();
    }
  } finally { c.restore(); }
}

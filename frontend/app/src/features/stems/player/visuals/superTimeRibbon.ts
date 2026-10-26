import { AMPLITUDE_WINDOW_SECONDS, PAST_WINDOW_SECONDS } from '../types';
import type { VisualizerInputs } from '../visualizers';
import { ribbonRange, ribbonX, RIBBON_WINDOW } from './ribbonTimeline';

const CAPACITY = 408;
const points = new WeakMap<HTMLCanvasElement, Float32Array>();
const tint = (hue: number, alpha: number, light = 65) => `hsla(${hue},95%,${light}%,${Math.max(0, Math.min(1, alpha))})`;
export function resetSuperRibbon(canvas: HTMLCanvasElement) { points.delete(canvas); }

export function drawSuperRibbon(c: CanvasRenderingContext2D, w: number, h: number,
  inputs: VisualizerInputs, hue: number, energy: number) {
  const { canvas, currentTime: time, duration, amplitudeEnvelope: envelope = [], amplitudeMaximum = 1 } = inputs;
  let data = points.get(canvas);
  if (!data) { data = new Float32Array(CAPACITY * 3); points.set(canvas, data); }
  const maximum = Number.isFinite(amplitudeMaximum) && amplitudeMaximum > 0 ? amplitudeMaximum : 1;
  const amplitude = (index: number) => index >= 0 && index < envelope.length && index * AMPLITUDE_WINDOW_SECONDS <= duration && Number.isFinite(envelope[index])
    ? Math.max(0, Math.min(1, envelope[index] / maximum)) : 0;
  const { first, last } = ribbonRange(time), count = Math.min(CAPACITY, last - first + 1);
  const base = h * .58, height = h * .44, center = PAST_WINDOW_SECONDS / RIBBON_WINDOW * w;
  const depthScale = .7 + energy * .9;
  const breathe = Math.sin(time * .7) * energy * h * .025;
  for (let i = 0; i < count; i++) {
    data[i * 3] = ribbonX(first + i, time, w);
    data[i * 3 + 1] = amplitude(first + i);
    data[i * 3 + 2] = base - data[i * 3 + 1] * height + breathe;
  }
  const trace = (depth: number, reflection = false) => {
    c.beginPath();
    for (let i = 0; i < count; i++) {
      const x = data[i * 3] - depth * depthScale * Math.min(18, w * .018);
      const y = reflection ? base + data[i * 3 + 1] * height * .58 - breathe * .5
        : base + depth * depthScale * h * .048 - data[i * 3 + 1] * height * (1 - depth * .095) + breathe;
      if (!i) c.moveTo(x, y); else c.lineTo(x, y);
    }
  };
  c.save();
  try {
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.lineJoin = 'round'; c.lineCap = 'round';
    const atmosphere = c.createRadialGradient(center, base, 0, center, base, Math.max(w * .35, h));
    atmosphere.addColorStop(0, tint(hue + 30, .09 + energy * .09));
    atmosphere.addColorStop(1, tint(hue + 90, 0));
    c.fillStyle = atmosphere; c.fillRect(0, 0, w, h);

    // Perspective layers share fixed source samples: depth without waveform shimmer.
    for (let layer = 5; layer >= 1; layer--) {
      trace(layer);
      c.strokeStyle = tint(hue + layer * 22, .12 + (6 - layer) * .035);
      c.lineWidth = 1 + (6 - layer) * .23; c.stroke();
    }
    // Cross-sections belong to source indices, so they never pop between screen pixels.
    c.strokeStyle = tint(hue + 70, .12 + energy * .08); c.lineWidth = .7; c.beginPath();
    for (let i = 0; i < count; i++) {
      if ((first + i) % 8 || data[i * 3 + 1] < .12) continue;
      c.moveTo(data[i * 3], data[i * 3 + 2]);
      c.lineTo(data[i * 3] - 5 * depthScale * Math.min(18, w * .018), base + depthScale * h * .24 - data[i * 3 + 1] * height * .525 + breathe);
    }
    c.stroke();

    // Mirrored lower edge closes a translucent ribbon rather than a filled bar chart.
    trace(0);
    for (let i = count - 1; i >= 0; i--) c.lineTo(data[i * 3], base + data[i * 3 + 1] * height * .58 - breathe * .5);
    c.closePath();
    const fill = c.createLinearGradient(0, base - height, 0, base + height * .58);
    fill.addColorStop(0, tint(hue, .32)); fill.addColorStop(.6, tint(hue + 50, .035)); fill.addColorStop(1, tint(hue + 115, .15));
    c.fillStyle = fill; c.fill();
    const spectrum = c.createLinearGradient(0, 0, w, 0);
    spectrum.addColorStop(0, tint(hue + 95, .9)); spectrum.addColorStop(.5, tint(hue, 1, 78)); spectrum.addColorStop(1, tint(hue - 55, .9));
    c.globalCompositeOperation = 'lighter';
    trace(0);
    c.strokeStyle = tint(hue, .07 + energy * .06); c.lineWidth = Math.min(16, 7 + h * .025); c.stroke();
    c.strokeStyle = tint(hue + 25, .24); c.lineWidth = 5; c.stroke();
    c.strokeStyle = spectrum; c.lineWidth = 2.1; c.stroke();
    trace(0, true); c.strokeStyle = tint(hue + 115, .3); c.lineWidth = 1.2; c.stroke();

    // Sparks are a bounded function of recently crossed envelope peaks, not random emissions.
    let particles = 0, pulse = 0;
    const nowIndex = Math.floor(time / AMPLITUDE_WINDOW_SECONDS);
    for (let index = nowIndex; index >= nowIndex - 20; index--) {
      const peak = amplitude(index), age = time - index * AMPLITUDE_WINDOW_SECONDS;
      if (age >= 1 || peak < .25 || peak <= amplitude(index - 1) + .035 || peak < amplitude(index + 1)) continue;
      pulse = Math.max(pulse, peak * Math.exp(-age * 5));
      const ring = age * Math.min(h * .45, w * .12);
      c.strokeStyle = tint(hue + 65, Math.sin(Math.PI * age) * energy * .55);
      c.lineWidth = 1 + (1 - age) * 1.5; c.beginPath();
      c.ellipse(center - age / RIBBON_WINDOW * w, base - peak * height, ring * 1.5, ring * .6, -.2, 0, Math.PI * 2); c.stroke();
      for (let ray = 0; ray < 3 && particles < 36; ray++, particles++) {
        const spread = Math.sin(index * 2.399 + ray * 2.1), travel = age * (1 - age * .25);
        const x = center - age / RIBBON_WINDOW * w + spread * travel * Math.min(w * .12, 90);
        const y = base - peak * height - travel * h * (.18 + ray * .055) + age * age * h * .24;
        c.strokeStyle = tint(hue + ray * 45, (1 - age) * (.25 + energy * .6)); c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(x - spread * 4, y + 5 * (1 - age)); c.lineTo(x, y); c.stroke();
      }
    }
    const position = time / AMPLITUDE_WINDOW_SECONDS, index = Math.floor(position);
    const level = amplitude(index) + (amplitude(index + 1) - amplitude(index)) * (position - index);
    const y = base - level * height + breathe;
    const radius = Math.max(7, Math.min(h * .24, 18 + energy * 16 + pulse * 18));
    const glow = c.createRadialGradient(center, y, 0, center, y, radius);
    glow.addColorStop(0, tint(hue, .65, 85)); glow.addColorStop(.2, tint(hue + 20, .3)); glow.addColorStop(1, tint(hue + 40, 0));
    c.fillStyle = glow; c.fillRect(center - radius, y - radius, radius * 2, radius * 2);
    c.strokeStyle = tint(hue, .15); c.lineWidth = 7; c.beginPath(); c.moveTo(center, 0); c.lineTo(center, h); c.stroke();
    c.strokeStyle = 'rgba(255,245,255,.85)'; c.lineWidth = 1; c.stroke();
    const diamond = 3 + pulse * 2;
    c.fillStyle = '#fff3fa'; c.beginPath(); c.moveTo(center, y - diamond); c.lineTo(center + diamond, y);
    c.lineTo(center, y + diamond); c.lineTo(center - diamond, y); c.closePath(); c.fill();
  } finally { c.restore(); }
}

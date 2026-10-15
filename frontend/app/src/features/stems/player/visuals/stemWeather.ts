import { bandLevel, signalRms, waveform } from './analysis';
import { beginVisualizer } from './canvas';
export type WeatherVoice = { name: string; input: boolean; analyser: AnalyserNode; audible: boolean };
type WeatherState = { lastTime: number; drums: number; bass: number; vocals: number; other: number; original: number; flash: number };
const states = new WeakMap<HTMLCanvasElement, WeatherState>();
export function resetWeather(canvas: HTMLCanvasElement) { states.delete(canvas); }
export function weatherRole(name: string, input: boolean): 'drums'|'bass'|'vocals'|'other'|'original' {
  if (input) return 'original';
  const stem = name.replace(/\.(mp3|wav)$/i, '').toLowerCase();
  return stem === 'drums' || stem === 'bass' || stem === 'vocals' ? stem : 'other';
}
export function drawStemWeather(canvas: HTMLCanvasElement, voices: WeatherVoice[], time: number, playing: boolean) {
  const view = beginVisualizer(canvas); if (!view) return;
  const {context: ctx, width: w, height: h, background} = view;
  try {
    let state = states.get(canvas);
    if (!state || time < state.lastTime || time - state.lastTime > .5) {
      state = {lastTime: time, drums: 0, bass: 0, vocals: 0, other: 0, original: 0, flash: 0}; states.set(canvas, state);
    }
    const dt = Math.max(0, Math.min(.1, time - state.lastTime)); state.lastTime = time;
    const levels = {drums: 0, bass: 0, vocals: 0, other: 0, original: 0};
    let vocalWave: Float32Array | undefined;
    for (const voice of voices) {
      if (!voice.audible) continue;
      const role = weatherRole(voice.name, voice.input), samples = waveform(voice.analyser);
      // Fixed scale follows the mixer level instead of normalizing away fader changes.
      levels[role] = Math.min(1, signalRms(samples) * 3.5);
      if (role === 'bass') levels.bass = Math.min(1, levels.bass * (0.45 + bandLevel(voice.analyser, 30, 250)));
      if (role === 'vocals') vocalWave = samples;
    }
    const onset = Math.max(0, levels.drums - state.drums);
    state.flash = playing ? Math.max(onset * 2, state.flash * Math.exp(-dt * 12)) : 0;
    for (const role of ['drums','bass','vocals','other','original'] as const) {
      // Explicit mute/solo removes the contribution immediately, including its trails.
      const enabled = voices.some(v => v.audible && weatherRole(v.name, v.input) === role);
      state[role] = enabled ? state[role] + (levels[role] - state[role]) * (playing ? 1 - Math.exp(-Math.max(.016, dt) * 9) : .25) : 0;
    }
    ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
    // Other instruments make broad translucent layers, rather than another waveform.
    if (state.other > .001) for (let layer = 0; layer < 4; layer++) {
      const gradient = ctx.createLinearGradient(0, h * .1, 0, h * .85);
      gradient.addColorStop(0, `rgba(110,158,176,${state.other * .16})`); gradient.addColorStop(1, 'rgba(197,139,188,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) {
        const y = h * (.2 + layer * .1) + Math.sin(x / w * 7 + time * .18 + layer) * h * (.03 + state.other * .07);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.fill();
    }
    if (state.original > .001) {
      const glow = ctx.createRadialGradient(w * .5, h * .5, 0, w * .5, h * .5, Math.max(w, h) * .55);
      glow.addColorStop(0, `rgba(201,156,102,${state.original * .2})`); glow.addColorStop(1, 'rgba(201,156,102,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    }
    if (state.drums > .001) {
      const energy = Math.min(1, state.drums + state.flash);
      ctx.strokeStyle = `rgba(201,156,102,${.15 + energy * .65})`; ctx.lineWidth = 1 + energy;
      ctx.beginPath();
      for (let i = 0; i < Math.round(12 + energy * 42); i++) {
        const seed = Math.sin(i * 127.1 + 91.7) * 43758.5453, offset = seed - Math.floor(seed);
        const x = ((i * .6180339 + offset * .3) % 1) * w;
        const y = ((time * (0.7 + offset) + offset) % 1) * h;
        const length = 3 + energy * (8 + offset * 26);
        ctx.moveTo(x, y); ctx.lineTo(x - length * .2, y + length);
      }
      ctx.stroke();
    }
    if (state.bass > .001) for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (let x = 0; x <= w + 4; x += 4) {
        const y = h * (.84 + band * .045) + Math.sin(x / w * Math.PI * 3 - time * 1.4 + band * .7) * state.bass * h * .13;
        if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = `rgba(201,156,102,${state.bass * (.15 - band * .03)})`; ctx.fill();
      ctx.strokeStyle = `rgba(221,177,128,${state.bass * .65})`; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (vocalWave && state.vocals > .001) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const sample = vocalWave[Math.min(vocalWave.length - 1, Math.floor(x / w * vocalWave.length))];
        const y = h * .48 + Math.sin(x / w * 5 + time * .35) * h * .045 * state.vocals + Math.tanh(sample * 2) * h * .18;
        if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,123,195,${Math.min(.95, state.vocals * 1.5)})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = .15; ctx.lineWidth = 7; ctx.stroke();
    }
  } finally { ctx.restore(); }
}

import { AMPLITUDE_WINDOW_SECONDS, PAST_WINDOW_SECONDS } from '../types';
import type { VisualizerInputs } from '../visualizers';
import { analysisBytes } from './analysis';
import { beginVisualizer } from './canvas';

import { ribbonX, ribbonRange, RIBBON_WINDOW as WINDOW } from './ribbonTimeline';
import { drawSuperRibbon, resetSuperRibbon } from './superTimeRibbon';
export { ribbonX, ribbonRange } from './ribbonTimeline';
type ColorState = { hue: number; time: number };
const colors = new WeakMap<HTMLCanvasElement, ColorState>();
type MotionState = { level: number; time: number };
const motion = new WeakMap<HTMLCanvasElement, MotionState>();
/** Slow, bounded movement; pause preserves it instead of following analyser decay. */
export function ribbonMotion(previous: MotionState | undefined, rms: number, time: number, playing: boolean): MotionState {
  const target = Number.isFinite(rms) ? Math.max(0, Math.min(1, rms * 2)) : 0;
  if (!previous) return { level: target, time };
  const dt = playing ? Math.max(0, Math.min(.05, time - previous.time)) : 0;
  return { level: previous.level + (target - previous.level) * (1 - Math.exp(-dt / .25)), time };
}
export function spectralHue(data: Uint8Array, sampleRate: number): number | null {
  let weight = 0, weightedFrequency = 0;
  for (let i = 1; i < data.length; i++) {
    const frequency = i / data.length * sampleRate / 2;
    if (frequency > 8000) break;
    const energy = (data[i] / 255) ** 2;
    weight += energy; weightedFrequency += frequency * energy;
  }
  return weight > .001 ? Math.min(280, weightedFrequency / weight / 2000 * 280) : null;
}
export function smoothRibbonColor(canvas: HTMLCanvasElement, data: Uint8Array, sampleRate: number, time: number, playing: boolean) {
  const state = ribbonHue(colors.get(canvas), spectralHue(data, sampleRate), time, playing);
  colors.set(canvas, state); return state.hue;
}
export function resetTimeRibbon(canvas: HTMLCanvasElement) { colors.delete(canvas); motion.delete(canvas); resetSuperRibbon(canvas); }

/** Keep competing spectral peaks from repainting the whole waveform in one frame. */
export function ribbonHue(previous: ColorState | undefined, target: number | null, time: number, playing: boolean): ColorState {
  if (!previous) return { hue: target ?? 325, time };
  if (!playing || target === null) return { hue: previous.hue, time };
  const dt = Math.max(0, Math.min(.05, time - previous.time));
  const delta = ((target - previous.hue + 540) % 360) - 180;
  const step = Math.sign(delta) * Math.min(Math.abs(delta) * (1 - Math.exp(-dt / .4)), 75 * dt);
  return { hue: (previous.hue + step + 360) % 360, time };
}

export function drawTimeRibbon({ canvas, analyser, currentTime, duration, isPlaying, amplitudeEnvelope,
  amplitudeMaximum = 1, sampleRate, visualizerType }: VisualizerInputs) {
  const view = beginVisualizer(canvas); if (!view) return;
  const {context: c,width:w,height:h,background,text,font}=view;
  try {
    c.fillStyle=background;c.fillRect(0,0,w,h);
    const baseY=Math.max(0,h-24), ribbonHeight=Math.max(1,h-40), start=currentTime-PAST_WINDOW_SECONDS;
    c.lineWidth=1;
    for(let second=Math.ceil(start);second<=start+WINDOW;second++){
      if(second<0 || second>duration)continue;
      const x=(second-start)/WINDOW*w;
      c.strokeStyle=second%5===0?'rgba(255,255,255,.10)':'rgba(255,255,255,.035)';
      c.beginPath();c.moveTo(x,0);c.lineTo(x,baseY);c.stroke();
    }
    if(!amplitudeEnvelope?.length){
      c.fillStyle=text;c.font=font;c.fillText('Analyzing track envelope for ribbon view...',10,baseY);return;
    }
    // Energy-weighted color is less sensitive than choosing a single loudest bin.
    const data=analysisBytes(analyser,analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const hue = smoothRibbonColor(canvas, data, sampleRate, currentTime, isPlaying);
    const superRibbon = visualizerType === 'super-time-ribbon';
    if (superRibbon) {
      const samples = analysisBytes(analyser, analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
      const state = ribbonMotion(motion.get(canvas), Math.sqrt(energy / Math.max(1, samples.length)), currentTime, isPlaying);
      motion.set(canvas, state);
      drawSuperRibbon(c, w, h, { canvas, analyser, currentTime, duration, isPlaying, amplitudeEnvelope,
        amplitudeMaximum, sampleRate, visualizerType }, hue, state.level);
      return;
    }
    const {first,last}=ribbonRange(currentTime);
    const maximum=Number.isFinite(amplitudeMaximum)&&amplitudeMaximum>0?amplitudeMaximum:1;
    c.save();c.beginPath();c.rect(0,0,w,h);c.clip();
    c.beginPath();
    // Fixed source samples translate together. Never resample against screen pixels:
    // that changes the shape of narrow peaks as their phase crosses the pixel grid.
    for(let index=first;index<=last;index++){
      const amplitude=index>=0 && index<amplitudeEnvelope.length && index*AMPLITUDE_WINDOW_SECONDS<=duration
        ? amplitudeEnvelope[index] : 0;
      const normalized=Number.isFinite(amplitude)?Math.max(0,Math.min(1,amplitude/maximum)):0;
      const x=ribbonX(index,currentTime,w),y=baseY-normalized*ribbonHeight;
      if(index===first)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.strokeStyle=`hsl(${hue},75%,65%)`;c.lineWidth=2;c.lineJoin='round';c.stroke();
    c.lineTo(ribbonX(last,currentTime,w),baseY);c.lineTo(ribbonX(first,currentTime,w),baseY);c.closePath();
    const fill=c.createLinearGradient(0,baseY-ribbonHeight,0,baseY);
    fill.addColorStop(0,`hsla(${hue},75%,65%,.22)`);fill.addColorStop(1,`hsla(${hue},75%,65%,.035)`);
    c.fillStyle=fill;c.fill();c.restore();
    const center=PAST_WINDOW_SECONDS/WINDOW*w;
    c.strokeStyle='rgba(255,255,255,.65)';c.lineWidth=1.5;
    c.beginPath();c.moveTo(center,0);c.lineTo(center,h);c.stroke();
  } finally {c.restore();}
}

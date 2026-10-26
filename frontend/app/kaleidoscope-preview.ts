import './src/styles/theme.css';
import './src/index.css';
import { drawVisualizer } from './src/features/stems/player/visualizers';
import { resizeVisualizer } from './src/features/stems/player/visuals/canvas';
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
new ResizeObserver(() => resizeVisualizer(canvas)).observe(canvas);
let time = 0, last = performance.now(), playing = true, muted = false;
const analyser = { fftSize: 2048, frequencyBinCount: 1024,
  getByteTimeDomainData(data: Uint8Array) {
    const energy = Number(document.querySelector<HTMLInputElement>('#energy')!.value);
    const amplitude = muted || !playing ? 0 : energy * (.12 + .7 * Math.exp(-(time % .6) * 11));
    for (let i = 0; i < data.length; i++) data[i] = 128 + Math.round(Math.sin(i * .08) * amplitude * 127);
  },
  getByteFrequencyData(data: Uint8Array) { data.fill(muted || !playing ? 0 : 100 + Math.round(130 * Math.exp(-(time % .6) * 10))); },
} as unknown as AnalyserNode;
document.querySelector('#pause')!.addEventListener('click', event => { playing = !playing; (event.target as HTMLButtonElement).textContent = playing ? 'Pause' : 'Resume'; });
document.querySelector('#mute')!.addEventListener('click', event => { muted = !muted; (event.target as HTMLButtonElement).textContent = muted ? 'Unmute' : 'Mute'; });
document.querySelector('#expand')!.addEventListener('click', () => { canvas.style.height = canvas.style.height === '650px' ? '340px' : '650px'; });
const timings: number[] = [];
function frame(now: number) {
  if (playing) time += Math.min(.1, (now - last) / 1000); last = now;
  const start = performance.now();
  drawVisualizer({ canvas, analyser, visualizerType: 'kaleidoscope', currentTime: time, duration: 300, isPlaying: playing, effectiveVolume: muted ? 0 : 1, sampleRate: 44100 });
  timings.push(performance.now() - start);
  if (timings.length === 120) {
    timings.sort((a, b) => a - b);
    document.querySelector('#timing')!.textContent = `Mean ${(timings.reduce((a,b)=>a+b)/120).toFixed(2)} ms · p95 ${timings[113].toFixed(2)} ms`; timings.length = 0;
  }
  document.querySelector('#status')!.textContent = `${playing ? 'Playing' : 'Paused'} · ${time.toFixed(2)}s${muted ? ' · Muted' : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

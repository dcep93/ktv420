import { drawPitchRibbon } from './src/features/stems/player/visuals/pitchRibbon';
import { loadPlateArtwork, musicNoteArtwork } from './src/features/stems/player/visuals/plateArtwork';
import './src/styles/theme.css';
import './src/index.css';
import { resizeVisualizer } from './src/features/stems/player/visuals/canvas';
import { combinedVisualizers, drawCombinedVisualizer, resetCombinedVisualizer, type CombinedVisualizerType } from './src/features/stems/player/visuals/combinedVisualizers';
import { drawSpectrogram } from './src/features/stems/player/visuals/spectrogram';
import { drawStereoBloom } from './src/features/stems/player/visuals/stereoBloom';
import { createStereoTap } from './src/features/stems/player/visuals/analysis';
const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas')!;
const spectrogram = document.querySelector<HTMLCanvasElement>('#spectrogram')!, bloom = document.querySelector<HTMLCanvasElement>('#bloom')!;
const pitchRibbon = document.querySelector<HTMLCanvasElement>('#pitch-ribbon')!;
const canvases = [canvas, spectrogram, bloom, pitchRibbon];
const observer = new ResizeObserver(() => canvases.forEach(resizeVisualizer)); canvases.forEach(c => observer.observe(c));
document.querySelector('#expand')!.addEventListener('click', () => {
  const expanded = canvas.parentElement!.classList.toggle('combined-visualizer--expanded');
  canvas.style.height = expanded ? '0' : '340px';
  document.querySelector('#expand')!.textContent = expanded ? 'Compact height' : 'Full height';
});
const picker = document.querySelector<HTMLSelectElement>('#scene')!;
let scene: CombinedVisualizerType = 'night-city', started = false, offset = 0;
let artwork = musicNoteArtwork;
let artworkLoad = new AbortController();
document.querySelector<HTMLInputElement>('#artwork')!.addEventListener('change', async event => {
  artworkLoad.abort(); artworkLoad = new AbortController();
  const signal = artworkLoad.signal;
  const file = (event.target as HTMLInputElement).files?.[0];
  const url = file ? URL.createObjectURL(file) : '';
  const field = await loadPlateArtwork(url, signal);
  if (!signal.aborted) artwork = field;
  if (url) URL.revokeObjectURL(url);
});
document.querySelector('#sample-artwork')!.addEventListener('click', async () => {
  artworkLoad.abort(); artworkLoad = new AbortController(); const signal = artworkLoad.signal;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#243d73"/><stop offset="1" stop-color="#edb8b0"/></linearGradient></defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="340" cy="166" r="85" fill="#fff0b5"/><path d="M0 390L178 128L330 390Z" fill="#24364a"/><path d="M178 128L122 212L170 196L190 226L216 199Z" fill="#fff"/><path d="M150 410L382 250L512 410V512H0V410Z" fill="#547e80"/><path d="M0 440Q230 340 512 450V512H0Z" fill="#171e32"/><text x="35" y="75" fill="white" font-family="sans-serif" font-weight="bold" font-size="42">AFTERGLOW</text></svg>`;
  const src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  const image = document.querySelector<HTMLImageElement>('#artwork-source')!; image.src = src; image.hidden = false;
  const field = await loadPlateArtwork(src, signal); if (!signal.aborted) artwork = field;
});
document.querySelector('#clear-artwork')!.addEventListener('click', () => {
  artworkLoad.abort(); artwork = musicNoteArtwork;
  document.querySelector<HTMLImageElement>('#artwork-source')!.hidden = true;
});
const timings: number[] = [];
for (const [value, option] of Object.entries(combinedVisualizers)) picker.add(new Option(option.label, value));
picker.value = scene;
function resetScene() {
  resetCombinedVisualizer(canvas); timings.length = 0;
}
picker.addEventListener('change', () => { scene = picker.value as CombinedVisualizerType; resetScene(); }); resetScene();
document.querySelector('#start')!.addEventListener('click', async () => {
  if (started) return; started = true;
  const context = new AudioContext(), silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
  const voices = ['drums', 'bass', 'vocals', 'other', 'original'].map((name, index) => {
    const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < buffer.length; i++) {
      const t = i / context.sampleRate, beat = t % .5, noise = Math.sin(i * 127.1) * 43758.5453 % 1;
      buffer.getChannelData(channel)[i] = name === 'drums' ? .55 * Math.exp(-beat * 30) * (Math.sin(t * 2 * Math.PI * 90) + noise * .5)
        : name === 'bass' ? .23 * Math.sin(2 * Math.PI * 82 * t) * (.65 + .35 * Math.sin(t * Math.PI))
        : name === 'vocals' ? .16 * (Math.sin(2 * Math.PI * (330 * t + 150 / 1.2 * Math.sin(t * 1.2))) + .3 * Math.sin(t * 2 * Math.PI * 660)) * (.65 + .35 * Math.sin(t * 2))
        : .12 * (Math.sin(t * 2 * Math.PI * (220 + channel * 2)) + Math.sin(t * 2 * Math.PI * (330 - channel * 2)));
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const gain = context.createGain(), analyser = context.createAnalyser(); analyser.fftSize = 2048;
    source.connect(gain); gain.connect(analyser); analyser.connect(silent); source.start();
    const voice = { name: name + '.mp3', input: name === 'original', analyser, audible: name !== 'original', index };
    gain.gain.value = voice.audible ? 1 : 0;
    const label = document.createElement('label'), toggle = document.createElement('input'), fader = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = voice.audible; toggle.ariaLabel = name;
    fader.type = 'range'; fader.min = '0'; fader.max = '1'; fader.step = '.01'; fader.value = '1'; fader.style.width = '80px'; fader.ariaLabel = name + ' level';
    const update = () => { voice.audible = toggle.checked && Number(fader.value) > 0; gain.gain.value = toggle.checked ? Number(fader.value) : 0; };
    toggle.addEventListener('change', update); fader.addEventListener('input', update);
    label.append(toggle, name, fader); document.querySelector('#voices')!.append(label);
    return voice;
  });
  const tap = createStereoTap(voices[3].analyser); await context.resume();
  const pause = document.querySelector<HTMLButtonElement>('#pause')!, seek = document.querySelector<HTMLButtonElement>('#seek')!;
  pause.disabled = seek.disabled = false;
  pause.addEventListener('click', async () => { if (context.state === 'running') { await context.suspend(); pause.textContent = 'Resume'; } else { await context.resume(); pause.textContent = 'Pause'; } });
  seek.addEventListener('click', () => { offset += 10; resetCombinedVisualizer(canvas); });
  const render = () => {
    const time = context.currentTime + offset, playing = context.state === 'running', start = performance.now();
    drawCombinedVisualizer(scene, canvas, voices, time, playing, artwork);
    timings.push(performance.now() - start);
    if (timings.length === 120) {
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length; timings.sort((a, b) => a - b);
      document.querySelector('#timing')!.textContent = `${combinedVisualizers[scene].label}: mean ${mean.toFixed(2)} ms · p95 ${timings[113].toFixed(2)} ms (120 frames, drawing commands + audio analysis)`; timings.length = 0;
    }
    drawPitchRibbon({ canvas: pitchRibbon, analyser: voices[2].analyser, currentTime: time, duration: 1000, visualizerType: 'pitch-ribbon', sampleRate: context.sampleRate, isPlaying: playing });
    drawSpectrogram(spectrogram, voices[2].analyser, time, playing); drawStereoBloom(bloom, tap); requestAnimationFrame(render);
  }; render();
  document.querySelector('#result')!.textContent = 'Live synthetic audio through the production renderers. Toggle stems to isolate their contributions.';
});

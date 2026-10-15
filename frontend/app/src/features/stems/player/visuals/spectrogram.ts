import { analysisBytes, frequencyBin } from './analysis';
import { beginVisualizer } from './canvas';
const HISTORY_SECONDS = 12, COLUMNS = 480, ROWS = 128;
type History = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; column: ImageData; bins: number[]; cursor: number; lastTime: number; lastWall: number; playing: boolean };
const histories = new WeakMap<HTMLCanvasElement, History>();
export function resetSpectrogram(canvas: HTMLCanvasElement) { histories.delete(canvas); }
export function drawSpectrogram(canvas: HTMLCanvasElement, analyser: AnalyserNode, time: number, playing: boolean) {
  const view = beginVisualizer(canvas); if (!view) return;
  const {context, width, height, background, text, font} = view;
  try {
    let history = histories.get(canvas);
    if (!history) {
      const strip = document.createElement('canvas'); strip.width = COLUMNS; strip.height = ROWS;
      const ctx = strip.getContext('2d')!;
      const maximum = Math.min(20000, analyser.context.sampleRate / 2);
      history = { canvas: strip, context: ctx, column: ctx.createImageData(1, ROWS), cursor: 0, lastTime: time, playing, lastWall: performance.now(),
        bins: Array.from({length: ROWS + 1}, (_, row) => frequencyBin(30 * (maximum / 30) ** (1 - row / ROWS), analyser.context.sampleRate, analyser.fftSize)) };
      histories.set(canvas, history);
    }
    // Pausing may reconcile the local clock by a few milliseconds. Preserve the
    // painted history; explicit seeks reset it independently of transport rounding.
    if (history.playing && !playing) history.lastTime = time;
    history.playing = playing;
    const wall = performance.now(), delta = time - history.lastTime;
    // Source time normally advances at 0.5–1.5x. Discontinuous jumps clear history.
    if (delta < -.15 || delta > Math.max(.25, (wall - history.lastWall) / 1000 * 1.75 + .1)) {
      history.context.clearRect(0, 0, COLUMNS, ROWS); history.cursor = 0; history.lastTime = time;
    }
    history.lastWall = wall;
    const columns = Math.min(COLUMNS, Math.floor(Math.max(0, time - history.lastTime) * COLUMNS / HISTORY_SECONDS));
    if (playing && columns > 0) {
      const data = analysisBytes(analyser, analyser.frequencyBinCount); analyser.getByteFrequencyData(data);
      for (let y = 0; y < ROWS; y++) {
        let peak = 0;
        for (let bin = history.bins[y + 1]; bin <= history.bins[y]; bin++) peak = Math.max(peak, data[bin] / 255);
        const energy = Math.max(0, (peak - .08) / .92), i = y * 4;
        // Quiet amber shadows, violet mids, pink/cream transients.
        history.column.data[i] = 30 + energy * 225;
        history.column.data[i + 1] = 20 + energy ** 2 * 178;
        history.column.data[i + 2] = 18 + Math.sin(energy * Math.PI / 2) * 170;
        history.column.data[i + 3] = energy > 0 ? 255 : 0;
      }
      for (let n = 0; n < columns; n++) { history.context.putImageData(history.column, history.cursor, 0); history.cursor = (history.cursor + 1) % COLUMNS; }
      history.lastTime += columns * HISTORY_SECONDS / COLUMNS;
    }
    context.fillStyle = background; context.fillRect(0, 0, width, height);
    const left = 36, plotWidth = Math.max(1, width - left), cursor = history.cursor;
    context.imageSmoothingEnabled = false;
    if (cursor < COLUMNS) context.drawImage(history.canvas, cursor, 0, COLUMNS - cursor, ROWS, left, 0, plotWidth * (COLUMNS - cursor) / COLUMNS, height);
    if (cursor) context.drawImage(history.canvas, 0, 0, cursor, ROWS, left + plotWidth * (COLUMNS - cursor) / COLUMNS, 0, plotWidth * cursor / COLUMNS, height);
    context.fillStyle = text; context.globalAlpha = .65; context.font = font;
    context.fillText('high', 5, 14); context.fillText('low', 5, height - 8);
    context.fillStyle = '#ff7bc3'; context.globalAlpha = .55; context.fillRect(width - 1, 0, 1, height);
  } finally { context.restore(); }
}

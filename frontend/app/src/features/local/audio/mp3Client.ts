import type { StereoAudio } from './types';
import type { StemAudio, ProgressCallback, SeparationProgress } from '../inference/types';
import type { Mp3Result } from './mp3Types';

/** A fresh worker is terminated after success, failure or cancellation, releasing LAME's WASM heap. */
export function encodeMp3InWorker(input: StereoAudio, stems: StemAudio, cancelled: () => boolean, progress: ProgressCallback): Promise<Mp3Result> {
  return new Promise((resolve, reject) => {
    if (cancelled()) { reject(new DOMException('Encoding cancelled.', 'AbortError')); return; }
    const worker = new Worker(new URL('./mp3Worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, result?: Mp3Result) => {
      clearInterval(timer); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setInterval(() => { if (cancelled()) finish(new DOMException('Encoding cancelled.', 'AbortError')); }, 50);
    worker.onmessage = ({ data }: MessageEvent<{ type: string; result: Mp3Result; progress: SeparationProgress; message: string }>) => {
      if (data.type === 'progress') progress(data.progress);
      else if (data.type === 'result') finish(undefined, data.result);
      else finish(new Error(data.message));
    };
    worker.onerror = event => finish(new Error(event.message || 'MP3 encoding worker stopped.'));
    try {
      // Processing owns these arrays and no longer uses them after encoding.
      const transfers = [...new Set([input, stems.drums, stems.bass, stems.other, stems.vocals].flatMap(audio => [audio.left.buffer, audio.right.buffer]))];
      worker.postMessage({ input, stems }, transfers);
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

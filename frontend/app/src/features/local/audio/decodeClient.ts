import { decodeWav } from './wav';
import type { StereoAudio } from './types';
export function decodeWavInWorker(bytes: ArrayBuffer, cancelled: () => boolean): Promise<StereoAudio> {
  // Node regression tests exercise the same decoder without browser workers.
  if (typeof Worker === 'undefined') return Promise.resolve(decodeWav(bytes));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./decodeWorker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, audio?: StereoAudio) => { clearInterval(timer); clearTimeout(timeout); worker.terminate(); if (error) reject(error); else resolve(audio!); };
    const timer = setInterval(() => { if (cancelled()) finish(new DOMException('Decoding cancelled.', 'AbortError')); }, 100);
    const timeout = setTimeout(() => finish(new DOMException('Audio decoding stopped responding.', 'TimeoutError')), 120000);
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(undefined, data.audio);
    worker.onerror = event => finish(new Error(event.message || 'Audio decoder stopped.'));
    worker.onmessageerror = () => finish(new Error('Audio decoder response was unreadable.'));
    try { worker.postMessage(bytes, [bytes]); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

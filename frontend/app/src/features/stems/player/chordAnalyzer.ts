import { centeredWindow, tuningCenters, type ChordSnapshot } from './harmony/chords';
import { frameSizeFor } from './harmony/spectrum';
import type { HarmonyReply, HarmonyRequest } from './harmony/worker';
export type { ChordSnapshot } from './harmony/chords';
export const CHORD_ANALYZER_VERSION = 5;

type AnalysisOptions = { signal?: AbortSignal; onProgress?: (fraction: number) => void };

/** Copy bounded windows, never transfer/detach the buffers used for live playback. */
export async function analyzeChordTimeline(buffer: AudioBuffer, { signal, onProgress }: AnalysisOptions = {}): Promise<ChordSnapshot[]> {
  signal?.throwIfAborted();
  if (!buffer.length) return [];
  if (!Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 192000 || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) {
    throw new Error('Harmony analysis needs mono or stereo audio at a supported sample rate.');
  }
  const worker = new Worker(new URL('./harmony/worker.ts', import.meta.url), { type: 'module' });
  let rejectPending: ((reason: unknown) => void) | undefined;
  const abort = () => { worker.terminate(); rejectPending?.(signal?.reason ?? new DOMException('Scan canceled', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
  const request = (message: HarmonyRequest, transfer: ArrayBuffer[] = []) => new Promise<HarmonyReply>((resolve, reject) => {
    signal?.throwIfAborted(); rejectPending = reject;
    worker.onmessage = ({ data }: MessageEvent<HarmonyReply>) => {
      rejectPending = undefined;
      if (data.type === 'error') reject(new Error(data.message)); else resolve(data);
    };
    worker.onerror = event => { event.preventDefault(); rejectPending = undefined; reject(new Error(event.message || 'Harmony analysis worker stopped.')); };
    worker.onmessageerror = () => { rejectPending = undefined; reject(new Error('Harmony analysis returned unreadable data.')); };
    worker.postMessage(message, transfer);
  });
  const size = frameSizeFor(buffer.sampleRate), hop = Math.round(buffer.sampleRate * .2);
  try {
    onProgress?.(0);
    const windows = tuningCenters(buffer.length).map(center => centeredWindow(buffer, center, size));
    await request({ type: 'tune', sampleRate: buffer.sampleRate, windows }, windows.flat().map(samples => samples.buffer as ArrayBuffer));
    signal?.throwIfAborted(); onProgress?.(.08);
    for (let center = 0; center < buffer.length;) {
      const windows: { time: number; channels: Float32Array[] }[] = [];
      for (let i = 0; i < 4 && center < buffer.length; i++, center += hop) {
        windows.push({ time: center / buffer.sampleRate, channels: centeredWindow(buffer, center, size) });
      }
      await request({ type: 'analyze', windows }, windows.flatMap(window => window.channels.map(samples => samples.buffer as ArrayBuffer)));
      signal?.throwIfAborted(); onProgress?.(.08 + .9 * Math.min(1, center / buffer.length));
    }
    const reply = await request({ type: 'finish' }); signal?.throwIfAborted();
    if (reply.type !== 'result') throw new Error('Harmony analysis did not return a timeline.');
    onProgress?.(1); signal?.throwIfAborted(); return reply.timeline;
  } finally {
    signal?.removeEventListener('abort', abort); worker.terminate();
  }
}

export function chordAtTime(timeline: ChordSnapshot[], time: number): ChordSnapshot | undefined {
  let low = 0, high = timeline.length - 1, result: ChordSnapshot | undefined;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (timeline[mid].time <= time) { result = timeline[mid]; low = mid + 1; } else high = mid - 1;
  }
  return result;
}

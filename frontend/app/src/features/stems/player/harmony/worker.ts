import { classifyChord, smoothTimeline, type ChordSnapshot } from './chords';
import { estimateTuning, HarmonicSpectrum } from './spectrum';

export type HarmonyRequest =
  | { type: 'tune'; sampleRate: number; windows: Float32Array[][] }
  | { type: 'analyze'; windows: { time: number; channels: Float32Array[] }[] }
  | { type: 'finish' };
export type HarmonyReply = { type: 'ready' } | { type: 'result'; timeline: ChordSnapshot[] } | { type: 'error'; message: string };
let spectrum: HarmonicSpectrum | undefined, tuning = 0;
const frames: ChordSnapshot[] = [];
self.onmessage = ({ data }: MessageEvent<HarmonyRequest>) => {
  try {
    let reply: HarmonyReply = { type: 'ready' };
    if (data.type === 'tune') {
      spectrum = new HarmonicSpectrum(data.sampleRate);
      tuning = estimateTuning(data.windows.map(channels => spectrum!.analyze(channels)));
      frames.length = 0;
    } else if (data.type === 'analyze') {
      if (!spectrum) throw new Error('Harmony worker is not initialized.');
      for (const window of data.windows) frames.push(classifyChord(spectrum.analyze(window.channels), tuning, window.time));
    } else reply = { type: 'result', timeline: smoothTimeline(frames) };
    self.postMessage(reply);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies HarmonyReply);
  }
};

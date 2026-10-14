import type { StereoAudio } from './types';
import type { StemAudio } from '../inference/types';
export const MP3_NAMES = ['input', 'drums', 'bass', 'other', 'vocals'] as const;
export type Mp3Files = Record<typeof MP3_NAMES[number], Blob>;
export type Mp3Encoding = { sampleRate: number; frames: number; gain: number };
export type Mp3Result = { files: Mp3Files; encoding: Mp3Encoding };
export type Mp3Request = { input: StereoAudio; stems: StemAudio };
export function mp3Layout(sampleRate: number, frames: number) {
  const outputRate = [32000, 44100, 48000].includes(sampleRate) ? sampleRate : 44100;
  return { sampleRate: outputRate, frames: Math.max(1, Math.round(frames * outputRate / sampleRate)) };
}

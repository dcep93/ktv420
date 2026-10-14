import mp3 from '@audio/encode-mp3';
import { resampleStereo } from './resample';
import { validateStereo, type StereoAudio } from './types';
import { MP3_NAMES, mp3Layout, type Mp3Files, type Mp3Result } from './mp3Types';
import type { ProgressCallback, StemAudio } from '../inference/types';

/** Worker-only encoder. A shared gain preserves relative levels without clipping Float32 input. */
export async function encodeMp3Set(input: StereoAudio, stems: StemAudio, progress: ProgressCallback = () => {}): Promise<Mp3Result> {
  const layout = mp3Layout(input.sampleRate, input.left.length);
  progress({ phase: 'encoding', fraction: 0, message: 'Preparing five aligned MP3 files' });
  const source = { input, ...stems };
  const signals = {} as Record<typeof MP3_NAMES[number], StereoAudio>;
  let peak = 1;
  for (const name of MP3_NAMES) {
    const audio = source[name]; validateStereo(audio);
    if (!input.left.length || audio.sampleRate !== input.sampleRate || audio.left.length !== input.left.length) throw new Error('All five signals must match the original length and rate.');
    const signal = resampleStereo(audio, layout.sampleRate, layout.frames);
    signals[name] = signal;
    for (const channel of [signal.left, signal.right]) for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new Error('Cannot encode non-finite audio samples.');
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  const gain = peak > 1 ? 0.95 / peak : 1;
  const files = {} as Mp3Files;
  for (const [index, name] of MP3_NAMES.entries()) {
    const encoder = await mp3({ ...layout, channels: 2, bitrate: 320 });
    try {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      const audio = signals[name];
      for (let start = 0; start < layout.frames; start += 16384) {
        const end = Math.min(layout.frames, start + 16384);
        const channels = [audio.left, audio.right].map(channel => {
          const chunk = channel.slice(start, end);
          if (gain !== 1) for (let i = 0; i < chunk.length; i++) chunk[i] *= gain;
          return chunk;
        });
        parts.push(new Uint8Array(encoder.encode(channels)));
        progress({ phase: 'encoding', fraction: (index + end / layout.frames) / 5, message: `Saving ${name} as 320 kbps MP3` });
      }
      parts.push(new Uint8Array(encoder.flush()));
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      const head = encoder.head?.();
      if (!head || head.length > blob.size) throw new Error('MP3 encoder did not produce a gapless header.');
      files[name] = new Blob([new Uint8Array(head), blob.slice(head.length)], { type: 'audio/mpeg' });
    } finally { encoder.free(); }
  }
  return { files, encoding: { ...layout, gain } };
}

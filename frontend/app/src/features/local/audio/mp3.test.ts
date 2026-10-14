import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMp3Set } from './mp3.ts';
import { MP3_NAMES } from './mp3Types.ts';
import { validateMp3 } from '../../../extension/mp3Validation.ts';

for (const rate of [32000, 44100, 48000, 22050]) test(`real LAME output is aligned 320 kbps stereo at ${rate} Hz`, async () => {
  const left = Float32Array.from({ length: 2401 }, (_, i) => 2 * Math.sin(i * 0.03));
  const audio = { left, right: left, sampleRate: rate };
  const result = await encodeMp3Set(audio, { drums: audio, bass: audio, other: audio, vocals: audio });
  assert.ok(result.encoding.gain > 0 && result.encoding.gain < 0.5);
  const { sampleRate, frames } = result.encoding;
  for (const name of MP3_NAMES) await validateMp3(result.files[name], sampleRate, frames);
  const bytes = new Uint8Array(await result.files.input.arrayBuffer());
  await assert.rejects(validateMp3(new Blob([bytes.subarray(0, bytes.length - 1)]), sampleRate, frames));
  await assert.rejects(validateMp3(result.files.input, sampleRate, frames + 1));
  await assert.rejects(validateMp3(result.files.input, sampleRate === 48000 ? 44100 : 48000, frames));
  for (const offset of [1, 2, 3, 36, 44, 48, 177, 178, 179, 184, 190, bytes.length - 50]) {
    const corrupt = bytes.slice(); corrupt[offset] ^= offset === 3 ? 0xc0 : 0xff;
    await assert.rejects(validateMp3(new Blob([corrupt]), sampleRate, frames), `offset ${offset}`);
  }
});
test('nonfinite and mismatched signals fail before encoding', async () => {
  const audio = { left: new Float32Array([NaN]), right: new Float32Array([0]), sampleRate: 44100 };
  await assert.rejects(encodeMp3Set(audio, { drums: audio, bass: audio, other: audio, vocals: audio }));
});

import { CHUNK_BYTES, validateCapture, type QueuedCapture } from './captureFormat';
import { MP3_NAMES, mp3Layout, type Mp3Encoding } from '../features/local/audio/mp3Types';
import { validateMp3 } from '../features/local/audio/mp3Validation';
export const AUDIO_NAMES = [...MP3_NAMES, 'artwork'] as const;
export type AudioName = typeof AUDIO_NAMES[number];
export type PreparedFile = { name: AudioName; bytes: number; sha256: string; type: string };
export type PreparedAudio = { id: string; capture: QueuedCapture; encoding: Mp3Encoding; metadata: Record<string, unknown>; files: PreparedFile[] };
export function parsePrepared(value: unknown): PreparedAudio {
  const p = value as PreparedAudio;
  if (!p || !p.capture || p.id !== p.capture.id || !/^[a-f0-9-]{36}$/.test(p.id) || !p.capture.complete) throw new Error('Invalid prepared recording.');
  validateCapture(p.capture.metadata, p.capture.expectedBytes);
  const layout = mp3Layout(Number(p.capture.metadata.audioSampleRate), p.capture.expectedBytes / (Number(p.capture.metadata.audioChannelCount) * 4));
  if (!p.encoding || p.encoding.sampleRate !== layout.sampleRate || p.encoding.frames !== layout.frames ||
    !Number.isFinite(p.encoding.gain) || p.encoding.gain <= 0 || p.encoding.gain > 1 ||
    !p.metadata || typeof p.metadata !== 'object' || JSON.stringify(p.metadata).length > 100000) throw new Error('Invalid prepared audio timing.');
  if (!Array.isArray(p.files) || p.files.length < 5 || p.files.length > 6 || new Set(p.files.map(f => f.name)).size !== p.files.length ||
    !MP3_NAMES.every(name => p.files.some(f => f.name === name)) || p.files.some(f => !AUDIO_NAMES.includes(f.name) ||
      !Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > (f.name === 'artwork' ? 10 * 1024 ** 2 : 256 * 1024 ** 2) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) || (f.name === 'artwork' ? !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) : f.type !== 'audio/mpeg'))) throw new Error('Invalid prepared audio files.');
  if (p.files.reduce((sum, f) => sum + f.bytes, 0) > 1024 ** 3) throw new Error('Prepared recording is too large.');
  return p;
}
export async function sha256(blob: Blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function validatePreparedFile(p: PreparedAudio, file: PreparedFile, blob: Blob) {
  if (blob.size !== file.bytes || await sha256(blob) !== file.sha256) throw new Error(`Damaged ${file.name} transfer.`);
  if (file.name !== 'artwork') await validateMp3(blob, p.encoding.sampleRate, p.encoding.frames);
}
export async function encodeBlobChunk(blob: Blob, index: number) {
  const bytes = new Uint8Array(await blob.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

import { decodeWav, encodeFloat32Wav } from './audio/wav';
import { saveInput } from './library';
import type { StereoAudio } from './audio/types';

export async function importAudio(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  let audio: StereoAudio;
  const isWav = bytes.byteLength >= 12 && new DataView(bytes).getUint32(0) === 0x52494646;
  if (isWav) audio = decodeWav(bytes);
  else {
    // Web Audio decodes compressed files at the context rate. Preserve the source file too.
    const context = new OfflineAudioContext(2, 1, 44100);
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.numberOfChannels > 2) throw new Error('Choose a mono or stereo source; multichannel downmixing is not automatic.');
    audio = { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(buffer.numberOfChannels - 1).slice(), sampleRate: buffer.sampleRate };
  }
  const id = crypto.randomUUID();
  const wav = isWav ? file : new Blob([encodeFloat32Wav(audio)], { type: 'audio/wav' });
  await saveInput({ id, title: file.name.replace(/\.[^.]+$/, ''), artist: '', createdAt: Date.now(),
    frames: audio.left.length, sampleRate: audio.sampleRate, status: 'captured', bytes: wav.size, source: 'file',
    metadata: { originalName: file.name, decodedAt44100: !isWav } }, wav, isWav ? undefined : file);
  return id;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

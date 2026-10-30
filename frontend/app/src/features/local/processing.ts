import { encodeMp3InWorker } from './audio/mp3Client';
import { decodeWav } from './audio/wav';
import { getInput, saveMp3, setTrackStatus } from './libraryClient';
import type { StereoAudio } from './audio/types';
import type { ProgressCallback, SeparationResult } from './inference/types';

type Separator = { separateStereo(audio: StereoAudio, progress?: ProgressCallback): Promise<SeparationResult> };
const defaultStorage = { getInput, saveMp3, setTrackStatus };
/** A commit is the point of no return: cancellation must never downgrade completed stems. */
export async function processLocalTrack(id: string, separator: Separator,
  cancelled: () => boolean, onProgress: ProgressCallback,
  storage = defaultStorage, encode = encodeMp3InWorker): Promise<void> {
  let committed = false;
  try {
    await storage.setTrackStatus(id, 'processing');
    if (cancelled()) return;
    const input = await storage.getInput(id);
    if (cancelled()) return;
    onProgress({ phase: 'loading', fraction: 0, message: 'Reading recording into memory…' });
    const bytes = await input.arrayBuffer();
    if (cancelled()) return;
    onProgress({ phase: 'loading', fraction: 0, message: 'Decoding recorded audio…' });
    const original = decodeWav(bytes);
    const result = await separator.separateStereo(original, onProgress);
    if (cancelled()) return;
    const encoded = await encode(original, result, cancelled, onProgress);
    if (cancelled()) return;
    await storage.saveMp3(id, encoded.files, result.metadata, encoded.encoding);
    committed = true;
  } catch (error) {
    if (!cancelled()) {
      await storage.setTrackStatus(id, 'error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  } finally {
    if (cancelled() && !committed) await storage.setTrackStatus(id, 'captured');
  }
}

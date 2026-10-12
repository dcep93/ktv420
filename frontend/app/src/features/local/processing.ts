import { decodeWav, encodeFloat32Wav } from './audio/wav';
import { getInput, saveStems, setTrackStatus, STEM_NAMES } from './library';
import type { StereoAudio } from './audio/types';
import type { ProgressCallback, SeparationResult } from './inference/types';

type Separator = { separateStereo(audio: StereoAudio, progress?: ProgressCallback): Promise<SeparationResult> };
const defaultStorage = { getInput, saveStems, setTrackStatus };
/** A commit is the point of no return: cancellation must never downgrade completed stems. */
export async function processLocalTrack(id: string, separator: Separator,
  cancelled: () => boolean, onProgress: ProgressCallback,
  storage = defaultStorage): Promise<void> {
  let committed = false;
  try {
    await storage.setTrackStatus(id, 'processing');
    if (cancelled()) return;
    const input = await storage.getInput(id);
    if (cancelled()) return;
    const bytes = await input.arrayBuffer();
    if (cancelled()) return;
    const result = await separator.separateStereo(decodeWav(bytes), onProgress);
    if (cancelled()) return;
    const stems = Object.fromEntries(STEM_NAMES.map(name => [name, new Blob([encodeFloat32Wav(result[name])], {type:'audio/wav'})])) as Record<typeof STEM_NAMES[number], Blob>;
    await storage.saveStems(id, stems, result.metadata);
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

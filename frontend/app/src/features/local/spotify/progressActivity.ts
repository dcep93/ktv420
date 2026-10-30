import type { SeparationProgress } from '../inference/types';

/** Waiting is not progress: retain the last operation and its actual fraction. */
export function progressActivity(progress: SeparationProgress, lastProgressAt: number, now = Date.now()): SeparationProgress {
  const seconds = Math.max(0, Math.floor((now - lastProgressAt) / 1000));
  return seconds < 15 ? progress : { ...progress, message: `${progress.message} · no new progress for ${seconds}s` };
}

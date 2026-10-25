import type { SeparationProgress } from './inference/types';

/** A stage-weighted estimate, never 100% before the saved track becomes ready. */
export function nextSeparationFraction(previous: number | null, progress: SeparationProgress): number | null {
  if (!Number.isFinite(progress.fraction)) return previous;
  const fraction = Math.max(0, Math.min(1, progress.fraction));
  const next = progress.phase === 'resampling' ? 0.05 * fraction
    : progress.phase === 'separating' ? 0.05 + 0.75 * fraction
    : progress.phase === 'restoring' ? 0.8 + 0.1 * fraction
    : progress.phase === 'complete' ? 0.9
    : progress.phase === 'encoding' ? 0.9 + 0.09 * fraction : null;
  return next === null ? previous : Math.max(previous ?? 0, next);
}

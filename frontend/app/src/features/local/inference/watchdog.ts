import type { SeparationProgress } from './types';

export const INFERENCE_SILENCE_MS = 5 * 60 * 1000;

/** Lives on the page: a blocked or vanished worker cannot run its own timeout. */
export function watchInference(onStall: (error: Error) => void) {
  let stopped = false, previous: SeparationProgress | undefined;
  let segmentStarted = 0, slowestSegment = 0;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stopped = true;
      const stage = previous?.message || 'Starting the separation worker';
      onStall(new DOMException(`Separation stopped responding (${stage}). Your recording is saved. Reload to resume, or retry in Settings.`, 'TimeoutError'));
    }, Math.max(INFERENCE_SILENCE_MS, slowestSegment * 8));
  };
  arm();
  return {
    progress(value: SeparationProgress) {
      if (stopped || previous && value.phase === previous.phase && value.fraction === previous.fraction && value.message === previous.message) return;
      const now = Date.now();
      if (value.phase === 'separating') {
        if (previous?.phase !== 'separating') segmentStarted = now;
        else if (value.fraction > previous.fraction) {
          slowestSegment = Math.max(slowestSegment, now - segmentStarted);
          segmentStarted = now;
        }
      }
      previous = { ...value };
      arm();
    },
    stop() { stopped = true; clearTimeout(timer); },
  };
}

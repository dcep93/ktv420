import type { LibrarySummary } from '../../shared/librarySummary';
import type { SeparationProgress } from './inference/types';

/** A cached website status is not evidence that its worker is still running. */
export function separationStatus(track: LibrarySummary | undefined, enabled: boolean, failure = '', now = Date.now()) {
  if (!track) return { label: 'Not captured', detail: '', busy: false, failed: false };
  if (track.status === 'ready') return { label: 'Ready', detail: 'Open in ktv420', busy: false, failed: false };
  if (track.location === 'website') {
    if (!track.updatedAt || now - track.updatedAt > 15000)
      return { label: 'Open ktv420 to continue', detail: 'Audio is saved in ktv420. Open it to check or resume separation.', busy: false, failed: false };
    const state = track.separation;
    return {
      label: state === 'paused' ? 'Paused in ktv420' : state === 'error' ? 'Needs retry in ktv420' : state === 'processing' ? 'Separating in ktv420' : 'Queued in ktv420',
      detail: state === 'paused' ? 'Open ktv420 → Settings → Resume separation.' : state === 'error' ? 'Open ktv420 → Settings to retry this song.' : 'Open ktv420 for separation progress.',
      busy: state === 'processing', failed: state === 'error',
    };
  }
  if (track.retryAt) return { label: `Retrying separation${track.retryAt > now ? ` in ${Math.ceil((track.retryAt - now) / 1000)}s` : '…'}`, detail: track.error || '', busy: false, failed: false };
  if (failure || track.status === 'error') return { label: 'Needs retry', detail: failure || track.error || 'Retry separation in Settings.', busy: false, failed: true };
  if (track.location === 'extension') {
    // Another Spotify overlay may own the active claim, independently of this view's pause switch.
    if (track.status === 'processing') return { label: separationProgressLabel(track.progress?.message || 'Starting separation worker', track.progress?.fraction ?? null), detail: track.progress?.message || 'Starting separation worker', busy: true, failed: false };
    return { label: enabled ? 'Queued' : 'Separation paused', detail: enabled ? 'Waiting for the next available separation slot.' : 'Resume separation in Settings.', busy: false, failed: false };
  }
  return { label: 'Captured · open ktv420', detail: 'Open ktv420 to check separation. Reload the extension for live queue status.', busy: false, failed: false };
}

/** Show the real operation and one overall percentage, never two competing percentages. */
export function separationProgressLabel(message: string, fraction: number | null) {
  if (fraction === null || !Number.isFinite(fraction)) return message;
  const step = message.replace(/\s*\(\s*\d+(?:\.\d+)?%\s*\)/g, '')
    .replace(/\s*[:·]?\s*~?\d+(?:\.\d+)?%/g, '').trim();
  // The row answers “what is happening?”; detailed stages stay in its tooltip.
  if (/Downloading model/.test(message)) return message.split(' · no new progress')[0];
  if (/model|worker/i.test(step) && !/Running|segment/i.test(step)) return 'Loading model…';
  const label = /segment|frequency|reconstruct|Running/i.test(step) ? 'Separating'
    : /Checking .*file|Saving|Verifying saved|Preparing saved|album artwork|Float32/i.test(step) ? 'Saving'
    : /Restor/i.test(step) ? 'Restoring audio' : /Reading|Decoding|Prepar|Resampl/i.test(step) ? 'Preparing audio' : step;
  return `${label} · ~${Math.round(Math.max(0, Math.min(.99, fraction)) * 100)}%`;
}

export function separationPhase(progress: SeparationProgress) {
  const labels: Record<SeparationProgress['phase'], string> = {
    download: 'Downloading model', loading: 'Loading audio / model', resampling: 'Preparing audio',
    restoring: 'Restoring audio', separating: 'Separating', encoding: 'Saving MP3', complete: 'Finishing',
  };
  return labels[progress.phase];
}

import type { LibrarySummary } from '../../shared/librarySummary';

/** Missing from a UI snapshot does not mean absent from the library. */
export function missingTrackLabel(libraryReady: boolean, summaryReady: boolean, summary?: LibrarySummary) {
  if (summary?.status === 'ready') return 'Loading saved stems…';
  if (!libraryReady || !summaryReady) return 'Loading…';
  return 'Not captured';
}

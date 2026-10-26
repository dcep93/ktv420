export type CaptureProgress = { trackId: string; fraction: number | null; phase?: 'saving' };

// Transfer completion and the next library snapshot travel independently.
// Retain the saving indicator until storage actually reports this track.
export function pendingCaptureSaves(previous: string[], progress: CaptureProgress | null, error: unknown): string[] {
  if (error) return [];
  return progress?.phase === 'saving' && !previous.includes(progress.trackId)
    ? [...previous, progress.trackId] : previous;
}
export function acknowledgeCaptureSaves(previous: string[], storedIds: string[]): string[] {
  const stored = new Set(storedIds);
  return previous.some(id => stored.has(id)) ? previous.filter(id => !stored.has(id)) : previous;
}

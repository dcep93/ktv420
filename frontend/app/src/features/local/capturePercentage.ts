/** Whole-collection progress: a saved song must not also count as in flight. */
export function capturePercentage(trackIds: string[], saved: ReadonlySet<string>, progress?: { trackId: string; fraction: number | null } | null): number {
  if (!trackIds.length) return 0;
  const fraction = Number.isFinite(progress?.fraction) ? Math.max(0, Math.min(1, progress!.fraction!)) : 0;
  const completed = trackIds.reduce((sum, id) => sum + (saved.has(id) ? 1 : progress?.trackId === id ? fraction : 0), 0);
  return Math.floor(100 * completed / trackIds.length);
}

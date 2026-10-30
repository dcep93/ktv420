/** Captures can start slightly after Spotify's zero; preserve that alignment. */
export function captureStartSeconds(metadata?: Record<string, unknown> | null): number {
  const value = typeof metadata?.crop === 'string' ? Number(metadata.crop.split('-')[0]) : 0;
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
}

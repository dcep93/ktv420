export type OverlayNavigation = { revision: number; open: boolean; trackIndex: number | null };
export function parseOverlayNavigation(value: unknown): OverlayNavigation | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || typeof v.open !== 'boolean' ||
    !(v.trackIndex === null || Number.isSafeInteger(v.trackIndex) && Number(v.trackIndex) >= 1 && Number(v.trackIndex) <= 10000)) return null;
  return { revision: Number(v.revision), open: v.open, trackIndex: v.trackIndex as number | null };
}

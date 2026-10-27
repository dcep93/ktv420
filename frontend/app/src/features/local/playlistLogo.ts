export function capturedPlaylistStart<T extends { trackId: string; rowIndex: number }>(
  rows: readonly T[], saved: readonly { id: string }[], libraryReady: boolean,
): T | null {
  if (!libraryReady || !rows.length) return null;
  const ids = new Set(saved.map(track => track.id));
  if (!rows.every(row => ids.has(`spotify-${row.trackId}`))) return null;
  return rows.find(row => row.rowIndex === 0) ?? null;
}

// Remove arithmetic residue so a slider reaching zero really silences its audio.
const clamp = (value: number) => Math.round(Math.max(0, Math.min(2, value)) * 1e12) / 1e12;

/** One input step, using only current positions. Clipped movement is discarded. */
export function linkedVolumes(
  volumes: Readonly<Record<string, number>>, locks: Readonly<Record<string, boolean>>,
  ids: readonly string[], editedId: string, target: number,
): Record<string, number> {
  if (!Number.isFinite(target) || !ids.includes(editedId)) return volumes;
  const next = clamp(target), delta = next - (volumes[editedId] ?? 1);
  const result = { ...volumes, [editedId]: next };
  if (locks[editedId]) for (const id of ids) {
    if (id !== editedId && !locks[id]) result[id] = clamp((volumes[id] ?? 1) - delta);
  }
  return result;
}

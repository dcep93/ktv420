/** Metadata only: combine staged captures with the website library status. */
export type LibrarySummary = { id: string; status: 'captured' | 'processing' | 'ready' | 'error' };
export function parseLibrarySummary(value: unknown): LibrarySummary[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid library summary.');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !/^spotify-[A-Za-z0-9]{1,100}$/.test(item.id) ||
      !['captured', 'processing', 'ready', 'error'].includes(item.status) || ids.has(item.id))
      throw new Error('Invalid library summary.');
    ids.add(item.id);
    return { id: item.id, status: item.status };
  });
}

import type { LocalTrack } from './library';
import type { LibrarySummary } from '../../shared/librarySummary';

/** Spotify embeds may have an isolated database. Only the relay knows their saved audio. */
export async function playlistSummary(
  embedded: boolean,
  shared: boolean,
  readLocal: () => Promise<LocalTrack[]>,
  readRemote: () => Promise<LibrarySummary[]>,
): Promise<LibrarySummary[]> {
  const remote = await readRemote();
  return embedded || !shared ? remote : sharedSummary(await readLocal(), remote);
}

/** Local commits are authoritative; relay metadata only adds active work or pending recordings. */
export function sharedSummary(local: LocalTrack[], remote: LibrarySummary[]): LibrarySummary[] {
  const tracks = new Map(local.map(t => [t.id, { id: t.id, status: t.status, error: t.error, location: 'shared' as const }]));
  const result = new Map<string, LibrarySummary>(tracks);
  for (const row of remote) {
    if (row.location !== 'extension' || tracks.get(row.id)?.status === 'ready') continue;
    result.set(row.id, { ...row, location: 'shared' });
  }
  return [...result.values()];
}

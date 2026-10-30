export type Collection = { path: string; title: string; artwork: string; trackIds: string[]; complete?: boolean };
export type SavedCollection = Collection & { savedAt: number; startedAt?: number };
export type SavedCollectionSummary = Omit<SavedCollection, 'trackIds'> & { captured: number; ready: number; total: number };
export function parseCollection(value: unknown): Collection | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.path !== 'string' || !/^(playlist|album)\/[A-Za-z0-9]{22}$/.test(v.path) ||
    typeof v.title !== 'string' || v.title.length > 500 || typeof v.artwork !== 'string' || v.artwork.length > 4096 ||
    !Array.isArray(v.trackIds) || !v.trackIds.length || v.trackIds.length > 10000 ||
    v.trackIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9]{1,100}$/.test(id))) return null;
  return { path: v.path, title: v.title.trim(), artwork: /^https:\/\/(?:i|mosaic)\.scdn\.co\//.test(v.artwork) ? v.artwork : '', trackIds: [...v.trackIds], ...(v.complete === true ? { complete: true } : {}) };
}
export function collectionLink(path: string) {
  return `https://open.spotify.com/${path}?ktv420`;
}
export function summarizeCollections(collections: SavedCollection[], tracks: { id: string; status: string }[]): SavedCollectionSummary[] {
  const saved = new Map(tracks.map(track => [track.id, track.status]));
  return collections.flatMap(({trackIds, ...collection}) => {
    const captured = trackIds.filter(id => saved.has(`spotify-${id}`)).length;
    const ready = trackIds.filter(id => saved.get(`spotify-${id}`) === 'ready').length;
    return captured || collection.startedAt ? [{...collection, captured, ready, total: trackIds.length}] : [];
  }).sort((a, b) => b.savedAt - a.savedAt);
}

import type { Collection } from './savedCollections';
import type { SpotifyTrack } from './usePlaylist';
export type PlaylistDetail = Collection & { tracks: SpotifyTrack[] };
export function playlistPath(id: string | null): string | null {
  const match = /^(album|playlist)\.([A-Za-z0-9]{22})$/.exec(id || '');
  return match ? `${match[1]}/${match[2]}` : null;
}
export function playlistIndex(search: string): number | null {
  const value = new URLSearchParams(search).get('ktv420') || '';
  return /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 10000 ? Number(value) : null;
}
export function localPlaylistLink(path: string, extension?: string | null): string {
  const params = new URLSearchParams({ id: path.replace('/', '.') });
  if (extension && /^[a-p]{32}$/.test(extension)) params.set('extension', extension);
  return `/playlist?${params}`;
}
export function localCatalogLink(extension?: string | null): string {
  return `/catalog${extension && /^[a-p]{32}$/.test(extension) ? `?extension=${extension}` : ''}`;
}
export function playlistViewUrl(href: string, index: number | null): string {
  const url = new URL(href);
  url.searchParams.delete('ktv420');
  if (index !== null) url.searchParams.set('ktv420', String(index));
  return url.href;
}

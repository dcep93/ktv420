import type { LocalTrack } from './library';
import type { SpotifyTrack } from './useSpotifyOverlay';

export function withSpotifyMetadata(track: LocalTrack, row?: SpotifyTrack): LocalTrack {
  if (track.source !== 'spotify' || !row || track.id !== `spotify-${row.trackId}`) return track;
  const title = row.trackName.trim() || track.title;
  const artist = row.trackArtist.trim() || track.artist;
  return { ...track, title, artist, metadata: { ...track.metadata, trackName: title, trackArtist: artist,
    trackArtworkSrc: row.trackArtworkSrc || track.metadata?.trackArtworkSrc || '',
  } };
}

// Playlist/album metadata is keyed by identity, never by whichever song happens
// to be visible when an earlier capture finishes saving.
export function withTrackMetadata(capture, track) {
  if (!track || track.trackId !== capture.trackId) return capture;
  const text = value => typeof value === 'string' ? value.trim() : '';
  return { ...capture,
    title: text(track.trackName) || capture.title,
    artist: text(track.trackArtist) || capture.artist,
    artwork: text(track.trackArtworkSrc) || capture.artwork,
  };
}

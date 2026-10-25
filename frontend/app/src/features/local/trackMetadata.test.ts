import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpotifyMetadata } from './trackMetadata';
import type { LocalTrack } from './library';

test('existing placeholder captures display matching Spotify metadata without altering audio or status', () => {
  const track: LocalTrack = { id: 'spotify-bottle', title: 'Spotify capture', artist: '', createdAt: 1,
    sampleRate: 44100, frames: 1234, bytes: 4567, status: 'processing', source: 'spotify', metadata: { crop: '0.012-0' } };
  const row = { trackId: 'bottle', trackName: 'Bottle', trackArtist: 'Remi Wolf', trackArtworkSrc: 'cover', rowIndex: 0 };
  const result = withSpotifyMetadata(track, row);
  assert.equal(result.title, 'Bottle'); assert.equal(result.artist, 'Remi Wolf');
  assert.deepEqual(result.metadata, { crop: '0.012-0', trackName: 'Bottle', trackArtist: 'Remi Wolf', trackArtworkSrc: 'cover' });
  assert.equal(result.status, track.status); assert.equal(result.frames, track.frames); assert.equal(result.bytes, track.bytes);
  assert.equal(track.title, 'Spotify capture', 'display enrichment does not mutate stored audio records');
  assert.equal(withSpotifyMetadata(track, { ...row, trackId: 'another' }), track);
  assert.equal(withSpotifyMetadata(track), track);
});

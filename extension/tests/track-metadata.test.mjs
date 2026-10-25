import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTrackMetadata } from '../src/content/trackMetadata.js';

test('capture gets title, artist and cover from its matching row even if Now Playing is empty or stale', () => {
  const capture = { trackId: 'bottle', title: '', artist: '', artwork: '', duration: 258, complete: true };
  const row = { trackId: 'bottle', trackName: 'Bottle', trackArtist: 'Remi Wolf', trackArtworkSrc: 'cover' };
  const result = withTrackMetadata(capture, row);
  assert.deepEqual(result, { ...capture, title: 'Bottle', artist: 'Remi Wolf', artwork: 'cover' });
  assert.equal(withTrackMetadata({ ...capture, title: 'Previous song' }, row).title, 'Bottle');
  assert.equal(withTrackMetadata(result, { ...row, trackId: 'champagne', trackName: 'Champagne' }), result,
    'finishing a capture after the next song starts must retain the old song identity');
  assert.deepEqual(withTrackMetadata(result, { trackId: 'bottle', trackName: ' ', trackArtist: '', trackArtworkSrc: '' }), result);
});

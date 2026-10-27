import assert from 'node:assert/strict';
import test from 'node:test';
import { capturedPlaylistStart } from './playlistLogo';

const rows = [{ trackId: 'a', rowIndex: 0 }, { trackId: 'b', rowIndex: 1 }, { trackId: 'c', rowIndex: 2 }];
const saved = rows.map((row, index) => ({ id: `spotify-${row.trackId}`, status: ['captured', 'processing', 'ready'][index] }));

test('opens row zero once every original is saved, including unfinished separation', () => {
  assert.equal(capturedPlaylistStart(rows, saved, true), rows[0]);
  assert.equal(capturedPlaylistStart([...rows].reverse(), saved, true), rows[0]);
});

test('keeps capture available when any playlist song is missing', () => {
  assert.equal(capturedPlaylistStart(rows, saved.slice(1), true), null);
  assert.equal(capturedPlaylistStart(rows, saved.slice(0, 2), true), null);
});

test('does not treat an unloaded or empty playlist as complete', () => {
  assert.equal(capturedPlaylistStart(rows, saved, false), null);
  assert.equal(capturedPlaylistStart([], saved, true), null);
  assert.equal(capturedPlaylistStart(rows, [], true), null);
  assert.equal(capturedPlaylistStart(rows.slice(1), saved, true), null);
});

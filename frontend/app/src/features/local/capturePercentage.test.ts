import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePercentage } from './capturePercentage';
test('playlist percentage remains steady when the current song is committed and the next starts', () => {
  const tracks = ['a', 'b', 'c', 'd'];
  assert.equal(capturePercentage(tracks, new Set(), { trackId: 'a', fraction: 1 }), 25);
  assert.equal(capturePercentage(tracks, new Set(['a']), { trackId: 'a', fraction: 1 }), 25);
  assert.equal(capturePercentage(tracks, new Set(['a']), null), 25);
  assert.equal(capturePercentage(tracks, new Set(['a']), { trackId: 'b', fraction: 0 }), 25);
  assert.equal(capturePercentage(tracks, new Set(['a']), { trackId: 'b', fraction: 0.5 }), 37);
  assert.equal(capturePercentage(tracks, new Set(tracks), { trackId: 'd', fraction: 1 }), 100);
});
test('progress counts duplicate playlist rows consistently and ignores unrelated captures', () => {
  assert.equal(capturePercentage(['a', 'a', 'b'], new Set(), { trackId: 'a', fraction: 0.5 }), 33);
  assert.equal(capturePercentage(['a', 'a', 'b'], new Set(['a']), { trackId: 'a', fraction: 1 }), 66);
  assert.equal(capturePercentage(['a'], new Set(), { trackId: 'b', fraction: 1 }), 0);
  assert.equal(capturePercentage([], new Set()), 0);
});

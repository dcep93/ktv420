import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverPlaylist, type PlaylistSnapshot } from './discover';

const path = 'album/19cvoEE5d3pMkxLFL5TsAG';
const row = { trackId: 'song', trackName: 'Song', trackArtist: 'Artist', trackArtworkSrc: '', rowIndex: 1 };
const complete: PlaylistSnapshot = { collection: { path, title: 'Album', artwork: '', trackIds: ['song'] }, tracks: [row], complete: true };

test('auto-open waits through empty and partial Spotify renders', async () => {
  const responses = [ { ...complete, tracks: [], complete: false }, { ...complete, complete: false }, complete ];
  let requests = 0;
  const result = await discoverPlaylist(path, async () => responses[requests++], () => false, async () => {});
  assert.equal(result, complete);
  assert.equal(requests, 3);
});

test('unmount during discovery discards the response and does not retry', async () => {
  let cancelled = false;
  const result = await discoverPlaylist(path, async () => { cancelled = true; return complete; }, () => cancelled);
  assert.equal(result, null);
});

test('discovery does not silently follow a different playlist', async () => {
  await assert.rejects(discoverPlaylist('album/another', async () => complete, () => false), /different playlist/);
});

test('an unavailable track list eventually fails instead of polling forever', async () => {
  let time = 0, requests = 0;
  await assert.rejects(discoverPlaylist(path, async () => { requests++; return { ...complete, complete: false }; },
    () => false, async () => { time += 30_000; }, () => time), /complete track list/);
  assert.equal(requests, 3);
});

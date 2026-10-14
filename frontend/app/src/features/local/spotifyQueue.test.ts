import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainSpotifyQueue } from './spotifyQueue.ts';
import type { LocalTrack } from './library.ts';

const track = (id: string, createdAt: number, status: LocalTrack['status'] = 'captured', source: LocalTrack['source'] = 'spotify'): LocalTrack =>
  ({ id, createdAt, status, source, title: id, artist: '', sampleRate: 44100, frames: 1, bytes: 8 });

test('Spotify queue picks up new captures in order, recovers interrupted work and skips files/completed/errors', async () => {
  const tracks = [track('later', 3), track('interrupted', 1, 'processing'), track('file', 0, 'captured', 'file'),
    track('ready', 0, 'ready'), track('failed', 0, 'error')];
  const processed: string[] = [];
  await drainSpotifyQueue({ list: async () => tracks, cancelled: () => false, onError: error => assert.fail(String(error)),
    process: async id => {
      processed.push(id); tracks.find(item => item.id === id)!.status = 'ready';
      if (id === 'interrupted') tracks.push(track('arrived', 2));
    },
  });
  assert.deepEqual(processed, ['interrupted', 'arrived', 'later']);
});

test('a failed track does not block subsequent captures or spin on unchanged storage', async () => {
  const tracks = [track('bad', 1), track('good', 2)];
  const processed: string[] = []; const errors: unknown[] = [];
  await drainSpotifyQueue({ list: async () => tracks, cancelled: () => false, onError: error => errors.push(error),
    process: async id => { processed.push(id); if (id === 'bad') throw new Error('Failed'); },
  });
  assert.deepEqual(processed, ['bad', 'good']); assert.equal(errors.length, 1);
});

test('pausing during one track leaves the next capture queued', async () => {
  let cancelled = false; const processed: string[] = [];
  await drainSpotifyQueue({ list: async () => [track('one', 1), track('two', 2)], cancelled: () => cancelled, onError: error => assert.fail(String(error)),
    process: async id => { processed.push(id); cancelled = true; },
  });
  assert.deepEqual(processed, ['one']);
});

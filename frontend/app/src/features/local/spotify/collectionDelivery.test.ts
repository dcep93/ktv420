import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaylistCollection } from './collectionDelivery';
import { rememberCollection } from '../collections';

const collection = (path: string) => ({ path, title: 'Immediate playlist', artwork: '', complete: true, trackIds: ['song'],
  tracks: [{ trackId: 'song', trackName: 'Song', trackArtist: 'Artist', trackArtworkSrc: '', rowIndex: 0 }] });

test('saved playlist opens without contacting an extension or waiting for audio delivery', async () => {
  const value = collection('album/aaaaaaaaaaaaaaaaaaaaaa');
  await rememberCollection(value, value.tracks);
  const result = await loadPlaylistCollection(value.path, async () => { throw new Error('No extension request should be made'); });
  assert.equal(result.tracks[0].trackName, 'Song');
});

test('new playlist imports only metadata before opening, even when no songs have arrived', async () => {
  const value = collection('album/bbbbbbbbbbbbbbbbbbbbbb'), calls: string[] = [];
  const result = await loadPlaylistCollection(value.path, async <T>(op: string): Promise<T> => {
    calls.push(op);
    if (op === 'collections') return [{ ...value, handoffId: 'handoff' }] as T;
    if (op === 'ack-collection') return undefined as T;
    throw new Error(`Audio import must not block first render: ${op}`);
  });
  assert.equal(result.tracks[0].trackName, 'Song');
  assert.deepEqual(calls, ['collections', 'ack-collection']);
});

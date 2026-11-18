import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginCapture,
  beginStreamingCapture,
  finishStreamingCapture,
  appendCapture,
  finishCapture,
  pendingCaptures,
  readChunk,
  acknowledgeCapture,
  queueTransaction,
  publishLibrarySummary,
  readLibrarySummary,
  rememberPlayerCollection,
  playerCollections,
  acknowledgePlayerCollection,
} from './queue';
import { parseRequest, websiteSender } from './protocol';
import { CHUNK_BYTES, decodeChunk } from '../shared/captureFormat';
const metadata = {
  trackId: 'testSong',
  audioSampleRate: 44100,
  audioChannelCount: 2,
  audioSampleFormat: 'PCM_F32LE',
  audioByteLength: 16,
  captureStartVerified: true,
  captureEndVerified: true,
};
const bytes = btoa(String.fromCharCode(...new Uint8Array(16)));
test('streaming remains invisible until verified exact final commit, with sender and format bound', async () => {
  const id = await beginStreamingCapture(503, metadata, 'document');
  await appendCapture(503, id, 0, bytes);
  assert.ok(!(await pendingCaptures()).some(c => c.id === id));
  await assert.rejects(readChunk(id, 0));
  await assert.rejects(finishCapture(503, id));
  await assert.rejects(finishStreamingCapture(504, id, metadata, 16));
  assert.throws(() => finishStreamingCapture(503, id, { ...metadata, captureEndVerified: false }, 16));
  await assert.rejects(finishStreamingCapture(503, id, { ...metadata, audioSampleRate: 48000 }, 16));
  await assert.rejects(finishStreamingCapture(503, id, { ...metadata, audioByteLength: 24 }, 24));
  await finishStreamingCapture(503, id, metadata, 16);
  const saved = (await pendingCaptures()).find(c => c.id === id)!;
  assert.equal(saved.expectedBytes, 16); assert.equal(saved.metadata.captureEndVerified, true);
  assert.equal(await readChunk(id, 0), bytes);
  await acknowledgeCapture(id);
});
test('capture chunk decoding preserves every byte value and padded chunk boundaries', () => {
  for (const length of [1, 2, 3, 256, CHUNK_BYTES - 2, CHUNK_BYTES - 1, CHUNK_BYTES]) {
    const expected = Buffer.alloc(length);
    for (let i = 0; i < length; i++) expected[i] = i % 256;
    assert.deepEqual(decodeChunk(expected.toString('base64')), new Uint8Array(expected));
  }
  for (const invalid of [null, '', '!!!!', 'A', 'AA=A', Buffer.alloc(CHUNK_BYTES + 1).toString('base64')]) {
    assert.throws(() => decodeChunk(invalid));
  }
});

test('a full raw chunk and partial tail survive durable capture delivery byte-for-byte', async () => {
  const source = Buffer.alloc(CHUNK_BYTES + 16);
  for (let i = 0; i < source.length; i++) source[i] = (i * 73) % 256;
  const id = await beginCapture(101, { ...metadata, audioByteLength: source.length }, source.length);
  await appendCapture(101, id, 0, source.subarray(0, CHUNK_BYTES).toString('base64'));
  await assert.rejects(finishCapture(101, id));
  await appendCapture(101, id, 1, source.subarray(CHUNK_BYTES).toString('base64'));
  await finishCapture(101, id);
  const chunks = await Promise.all([readChunk(id, 0), readChunk(id, 1)]);
  assert.deepEqual(Buffer.concat(chunks.map(chunk => Buffer.from(chunk, 'base64'))), source);
  await acknowledgeCapture(id);
});
test('completed temporary captures survive new captures and are removed only by acknowledgment', async () => {
  const id = await beginCapture(1, metadata, 16);
  await appendCapture(1, id, 0, bytes);
  await finishCapture(1, id);
  await beginCapture(1, metadata, 16);
  assert.ok((await pendingCaptures()).some((c) => c.id === id));
  assert.equal(await readChunk(id, 0), bytes);
  await acknowledgeCapture(id);
  assert.ok(!(await pendingCaptures()).some((c) => c.id === id));
  await acknowledgeCapture(id);
});
test('chunk retries are idempotent but changed bytes, gaps and sender mismatches abort', async () => {
  const id = await beginCapture(2, metadata, 16);
  await appendCapture(2, id, 0, bytes);
  await appendCapture(2, id, 0, bytes);
  await assert.rejects(appendCapture(2, id, 0, btoa('1111111111111111')));
  await assert.rejects(appendCapture(3, id, 1, bytes));
  await assert.rejects(appendCapture(2, id, 3, bytes));
  await assert.rejects(finishCapture(3, id));
  await finishCapture(2, id);
  assert.equal((await pendingCaptures()).find((c) => c.id === id)?.receivedBytes, 16);
  await acknowledgeCapture(id);
});
test('incomplete and unverified recordings cannot be delivered or acknowledged', async () => {
  await assert.rejects(beginCapture(1, { ...metadata, captureStartVerified: false }, 16));
  const id = await beginCapture(9, metadata, 16);
  await assert.rejects(finishCapture(9, id));
  await assert.rejects(readChunk(id, 0));
  await assert.rejects(acknowledgeCapture(id));
  await assert.rejects(queueTransaction(['captures'], 'readwrite', (tx) => tx.abort()));
});
test('only the exact top-level website origin and bounded explicit v1 operations are accepted', () => {
  assert.ok(websiteSender({ url: 'https://ktv420.web.app/playlist?id=test', frameId: 0 }));
  for (const sender of [
    { url: 'https://ktv420.web.app.evil.test', frameId: 0 },
    { url: 'http://ktv420.web.app', frameId: 0 },
    { url: 'https://ktv420.web.app', frameId: 1 },
    { url: 'https://open.spotify.com', frameId: 0 },
    { url: 'https://ktv420.web.app' },
  ])
    assert.equal(websiteSender(sender), false);
  const base = { protocol: 'ktv420-spotify', version: 1, operation: 'status' };
  assert.equal(parseRequest(base).operation, 'status');
  assert.equal(parseRequest({ ...base, type: 'arbitrary', script: 'code' }).script, undefined);
  const capture = {
    ...base,
    operation: 'capture',
    trackId: 'track',
    requestId: crypto.randomUUID(),
    path: 'album/2222222222222222222222',
  };
  assert.equal(parseRequest(capture).path, capture.path);
  assert.throws(() => parseRequest({ ...capture, path: 'https://other.test' }));
  for (const bad of [
    { ...base, version: 2 },
    { ...base, operation: 'eval' },
    { ...base, tabId: 7 },
    { ...base, operation: 'view', trackIndex: -1 },
    { ...base, operation: 'presentation', title: 42 },
    { ...base, operation: 'volume', volume: Infinity },
    { ...base, operation: 'capture', trackId: '../bad', requestId: crypto.randomUUID() },
    { ...base, operation: 'chunk', id: crypto.randomUUID(), index: -1 },
  ])
    assert.throws(() => parseRequest(bad));
});

test('capture metadata bridges delivery and website processing without a second audio library', async () => {
  await publishLibrarySummary([]);
  const id = await beginCapture(77, { ...metadata, trackId: 'summarySong' }, 16);
  await appendCapture(77, id, 0, bytes);
  await finishCapture(77, id);
  assert.deepEqual((await readLibrarySummary()).find(t => t.id === 'spotify-summarySong'), { id: 'spotify-summarySong', status: 'captured' });
  await acknowledgeCapture(id);
  assert.deepEqual((await readLibrarySummary()).find(t => t.id === 'spotify-summarySong'), { id: 'spotify-summarySong', status: 'captured' });
  await publishLibrarySummary([{ id: 'spotify-summarySong', status: 'ready', audio: 'must not be stored' }]);
  const summary = await readLibrarySummary();
  assert.deepEqual(summary.map(({ id, status }) => ({ id, status })), [{ id: 'spotify-summarySong', status: 'ready' }]);
  assert.equal(summary[0].location, 'website'); assert.ok(summary[0].updatedAt); assert.equal('audio' in summary[0], false);
  await publishLibrarySummary([]); // Website deletion clears the status cache too.
  assert.deepEqual(await readLibrarySummary(), []);
});
test('library summary validation rejects malformed IDs, duplicate rows and unknown status', async () => {
  for (const value of [[{ id: '../secret', status: 'ready' }], [{ id: 'spotify-a', status: 'anything' }],
    [{ id: 'spotify-a', status: 'ready' }, { id: 'spotify-a', status: 'captured' }]]) {
    assert.throws(() => parseRequest({ protocol: 'ktv420-spotify', version: 1, operation: 'publish-library', tracks: value }), /Invalid library summary/);
  }
});

test('playlist handoff persists membership without new audio and stale acknowledgments cannot erase a newer handoff', async () => {
  const path = 'playlist/1111111111111111111111';
  const snapshot = { complete: true, collection: { path, title: 'New playlist', artwork: '', trackIds: ['known'] },
    tracks: [{ trackId: 'known', trackName: 'Known song', trackArtist: 'Artist', trackArtworkSrc: '', rowIndex: 0 }] };
  await rememberPlayerCollection(snapshot);
  const first = (await playerCollections() as { path: string; handoffId: string }[]).find(c => c.path === path)!;
  await rememberPlayerCollection(snapshot);
  await acknowledgePlayerCollection(path, first.handoffId);
  const next = (await playerCollections() as { path: string; handoffId: string; tracks: unknown[] }[]).find(c => c.path === path)!;
  assert.notEqual(next.handoffId, first.handoffId);
  assert.deepEqual(next.tracks, snapshot.tracks);
  await acknowledgePlayerCollection(path, next.handoffId);
  assert.equal((await playerCollections() as unknown[]).length, 0);
});

test('published separation state has relay-assigned freshness and website ownership', async () => {
  const before = Date.now();
  await publishLibrarySummary([{ id: 'spotify-pausedSong', status: 'captured', separation: 'paused', updatedAt: 1 }]);
  const row = (await readLibrarySummary()).find(t => t.id === 'spotify-pausedSong')!;
  assert.equal(row.separation, 'paused');
  assert.equal(row.location, 'website');
  assert.ok(row.updatedAt! >= before);
});

test('late website snapshots cannot overwrite a newer deletion', async () => {
  const revision = Date.now() * 1024 + 100;
  await publishLibrarySummary([{ id: 'spotify-stale', status: 'ready' }], revision);
  await publishLibrarySummary([], revision + 2);
  await publishLibrarySummary([{ id: 'spotify-stale', status: 'ready' }], revision + 1);
  assert.equal((await readLibrarySummary()).some(t => t.id === 'spotify-stale'), false);
});

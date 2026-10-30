import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginCapture,
  appendCapture,
  finishCapture,
  pendingCaptures,
  readChunk,
  acknowledgeCapture,
  queueTransaction,
  publishLibrarySummary,
  readLibrarySummary,
} from './queue';
import { parseRequest, websiteSender } from './protocol';
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
  assert.deepEqual(await readLibrarySummary(), [{ id: 'spotify-summarySong', status: 'ready' }]);
  await publishLibrarySummary([]); // Website deletion clears the status cache too.
  assert.deepEqual(await readLibrarySummary(), []);
});
test('library summary validation rejects malformed IDs, duplicate rows and unknown status', async () => {
  for (const value of [[{ id: '../secret', status: 'ready' }], [{ id: 'spotify-a', status: 'anything' }],
    [{ id: 'spotify-a', status: 'ready' }, { id: 'spotify-a', status: 'captured' }]]) {
    assert.throws(() => parseRequest({ protocol: 'ktv420-spotify', version: 1, operation: 'publish-library', tracks: value }), /Invalid library summary/);
  }
});

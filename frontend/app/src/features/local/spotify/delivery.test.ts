import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveCapture } from './delivery';
import { getInput, getTrack, transaction, deleteTrack } from '../library';
import { savedCollection } from '../collections';
import { decodeWav } from '../audio/wav';
import type { QueuedCapture } from '../../../shared/captureFormat';
function fixture() {
  const pcm = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i) * 0.25),
    bytes = new Uint8Array(pcm.buffer),
    trackId = crypto.randomUUID().replaceAll('-', '');
  const capture: QueuedCapture = {
    id: crypto.randomUUID(),
    tabId: 1,
    complete: true,
    createdAt: 1,
    expectedBytes: bytes.length,
    receivedBytes: bytes.length,
    nextChunk: 2,
    metadata: {
      trackId,
      trackName: 'Known signal',
      trackArtist: 'Test',
      audioSampleRate: 44100,
      audioChannelCount: 2,
      audioSampleFormat: 'PCM_F32LE',
      audioByteLength: bytes.length,
      captureStartVerified: true,
      captureEndVerified: true,
      collection: {
        path: 'album/1111111111111111111111',
        title: 'Delivery',
        artwork: '',
        trackIds: [trackId],
        complete: true,
      },
    },
  };
  const chunks = [bytes.slice(0, 200), bytes.slice(200)].map((b) =>
    btoa(String.fromCharCode(...b)),
  );
  return { capture, pcm, chunks };
}
test('delivery resumes at committed chunk, preserves exact PCM and acknowledges only a committed library record', async () => {
  const { capture, pcm, chunks } = fixture();
  let fail = true,
    acks = 0;
  const requests: number[] = [];
  const request = async <T>(operation: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (operation === 'chunk') {
      requests.push(Number(args.index));
      if (fail && args.index === 1) throw new Error('Disconnected');
      return chunks[Number(args.index)] as T;
    }
    if (operation === 'ack') {
      assert.ok(await getTrack(`spotify-${capture.metadata.trackId}`));
      acks++;
      return undefined as T;
    }
    throw new Error('Unexpected operation');
  };
  await assert.rejects(receiveCapture(capture, request), /Disconnected/);
  assert.equal(acks, 0);
  assert.equal(await getTrack(`spotify-${capture.metadata.trackId}`), undefined);
  fail = false;
  await receiveCapture(capture, request);
  assert.deepEqual(requests, [0, 1, 1]);
  assert.equal(acks, 1);
  const decoded = decodeWav(
    await (await getInput(`spotify-${capture.metadata.trackId}`)).arrayBuffer(),
  );
  assert.deepEqual(
    [...decoded.left],
    Array.from(pcm).filter((_, i) => i % 2 === 0),
  );
  assert.ok(
    (await savedCollection('album/1111111111111111111111')).trackIds.includes(
      String(capture.metadata.trackId),
    ),
  );
  await receiveCapture(capture, request);
  assert.deepEqual(requests, [0, 1, 1]);
  assert.equal(acks, 2);
});
test('failed library commit leaves delivery unacknowledged; reconnect retries without duplicate audio', async () => {
  const { capture, chunks } = fixture();
  let acks = 0;
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'chunk') return chunks[Number(args.index)] as T;
    acks++;
    return undefined as T;
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const r = put.call(this, value, key);
    if (this.name === 'receipts') this.transaction.abort();
    return r;
  };
  try {
    await assert.rejects(receiveCapture(capture, request));
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal(acks, 0);
  assert.equal(await getTrack(`spotify-${capture.metadata.trackId}`), undefined);
  await receiveCapture(capture, request);
  assert.equal(acks, 1);
  const count = await transaction<number>(['audio'], 'readonly', (tx, done) => {
    const r = tx.objectStore('audio').index('trackId').count(`spotify-${capture.metadata.trackId}`);
    r.onsuccess = () => done(r.result);
  });
  assert.equal(count, 1);
});
test('lost acknowledgment retries only acknowledgment and never resurrects deliberately deleted audio', async () => {
  const { capture, chunks } = fixture();
  let fail = true,
    reads = 0;
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'chunk') {
      reads++;
      return chunks[Number(args.index)] as T;
    }
    if (fail) throw new Error('Lost ack');
    return undefined as T;
  };
  await assert.rejects(receiveCapture(capture, request), /Lost ack/);
  await deleteTrack(`spotify-${capture.metadata.trackId}`);
  fail = false;
  await receiveCapture(capture, request);
  assert.equal(reads, 2);
  assert.equal(await getTrack(`spotify-${capture.metadata.trackId}`), undefined);
});

test('website delivery never requests or acknowledges raw captures, including older extensions', async () => {
  const { drainDeliveries } = await import('./delivery');
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, fn: (lock: object) => unknown) => fn({}) } });
  try {
    for (const stagedAudio of [false, true]) {
      const calls: string[] = [];
      await drainDeliveries(async <T>(operation: string): Promise<T> => {
        calls.push(operation);
        if (operation === 'hello') return { stagedAudio } as T;
        if (operation === 'collections' || operation === 'prepared') return [] as T;
        throw new Error(`Unexpected raw delivery: ${operation}`);
      });
      assert.ok(!calls.some(op => ['pending', 'chunk', 'ack', 'claim-capture'].includes(op)));
    }
  } finally { if (previous) Object.defineProperty(navigator, 'locks', previous); else Reflect.deleteProperty(navigator, 'locks'); }
});

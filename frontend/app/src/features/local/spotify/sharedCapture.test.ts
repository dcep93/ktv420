import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processSharedCapture } from './sharedCapture';
import { getTrack, getInput, getPlaybackRecord, deleteTrack } from '../library';
import { processLocalTrack } from '../processing';
import { encodeMp3Set } from '../audio/mp3';
import type { QueuedCapture } from '../../../shared/captureFormat';
import type { SeparationResult } from '../inference/types';
Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, fn: (lock: object) => unknown) => fn({}) } });
function fixture() {
  const frames = 6000, samples = Float32Array.from({length: frames * 2}, (_, i) => Math.sin(i / 2 * 2 * Math.PI * 220 / 44100) * .2);
  const bytes = new Uint8Array(samples.buffer), trackId = crypto.randomUUID().replaceAll('-', '');
  const capture: QueuedCapture = { id: crypto.randomUUID(), tabId: 1, complete: true, createdAt: Date.now(), expectedBytes: bytes.length, receivedBytes: bytes.length, nextChunk: 1,
    metadata: { trackId, trackName: 'Shared test', trackArtist: 'Synthetic', audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes.length, captureStartVerified: true, captureEndVerified: true,
      collection: { path: 'album/aaaaaaaaaaaaaaaaaaaaaa', title: 'Shared library', artwork: '', trackIds: [trackId] } } };
  const ops: string[] = []; let acks = 0, calls = 0, failAck = false;
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    ops.push(op);
    if (op === 'work-chunk') return btoa(String.fromCharCode(...bytes)) as T;
    if (op === 'work-commit') {
      if (args.discarded !== true) {
        assert.equal((await getTrack(`spotify-${trackId}`))?.status, 'ready');
        assert.equal((await getPlaybackRecord(`spotify-${trackId}`)).files.length, 5);
      }
      if (failAck) throw Error('Lost acknowledgment');
      acks++; return undefined as T;
    }
    throw Error(`Unexpected output transfer: ${op}`);
  };
  const separator = { async separateStereo(audio: {left: Float32Array; right: Float32Array; sampleRate: number}) { calls++; return { drums: audio, bass: audio, other: audio, vocals: audio, metadata: {} } as SeparationResult; } };
  const run = (cancelled = () => false) => processSharedCapture(capture, 'token', request, separator, cancelled, () => {},
    (id, worker, cancel, report, storage) => processLocalTrack(id, worker, cancel, report, storage, encodeMp3Set));
  return { capture, ops, run, id: `spotify-${trackId}`, get acks() {return acks;}, get calls() {return calls;}, set failAck(value: boolean) { failAck = value; } };
}
test('background separation saves five MP3s directly in the website and never uploads prepared output', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.acks, 1); assert.equal(f.calls, 1);
  assert.deepEqual(f.ops, ['work-chunk', 'work-commit']);
  const track = await getTrack(f.id); assert.equal(track?.status, 'ready'); assert.equal(track?.title, 'Shared test');
  await assert.rejects(getInput(f.id), 'raw WAV was atomically replaced by MP3');
});
test('crash after commit retries acknowledgment without reading raw input or separating again', async () => {
  const f = fixture(); f.failAck = true;
  await assert.rejects(f.run(), /Lost acknowledgment/);
  assert.equal((await getTrack(f.id))?.status, 'ready');
  f.failAck = false; await f.run();
  assert.equal(f.calls, 1); assert.equal(f.acks, 1);
  assert.deepEqual(f.ops, ['work-chunk', 'work-commit', 'work-commit']);
});
test('intentional deletion discards the temporary source without resurrecting audio', async () => {
  const f = fixture(); f.failAck = true; await assert.rejects(f.run());
  await deleteTrack(f.id); f.failAck = false; await f.run();
  assert.equal(await getTrack(f.id), undefined); assert.equal(f.calls, 1); assert.equal(f.acks, 1);
});
test('canceling before work leaves source unacknowledged', async () => {
  const f = fixture(); await f.run(() => true); assert.equal(f.acks, 0); assert.equal(f.calls, 0); assert.deepEqual(f.ops, []);
});
test('failed durable MP3 commit retains the raw recording and never acknowledges it', async () => {
  const f = fixture(), put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    const r = put.call(this, value, key);
    if (this.name === 'tracks' && value.status === 'ready') this.transaction.abort();
    return r;
  };
  try { await assert.rejects(f.run()); } finally { IDBObjectStore.prototype.put = put; }
  assert.equal(f.acks, 0); assert.ok((await getInput(f.id)).size > 0); assert.equal((await getTrack(f.id))?.status, 'error');
  await f.run(); assert.equal(f.acks, 1); assert.equal((await getTrack(f.id))?.status, 'ready');
});

test('another shared-library writer prevents inference or acknowledgment until its lock is released', async () => {
  const f = fixture(), locks = navigator.locks;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, fn: (lock: null) => unknown) => fn(null) } });
  try { await f.run(); assert.deepEqual(f.ops, []); assert.equal(f.calls, 0); }
  finally { Object.defineProperty(navigator, 'locks', { configurable: true, value: locks }); }
});


test('ready MP3 replacement uses strict durability before the temporary recording is acknowledged', async () => {
  const f = fixture(), transaction = IDBDatabase.prototype.transaction;
  const modes: string[] = [];
  IDBDatabase.prototype.transaction = function(stores, mode, options) {
    if (this.name === 'ktv420-web-library-v1' && mode === 'readwrite' && Array.isArray(stores) && stores.length === 2 && stores.includes('tracks') && stores.includes('audio')) modes.push(options?.durability || 'default');
    return transaction.call(this, stores, mode, options);
  };
  try { await f.run(); } finally { IDBDatabase.prototype.transaction = transaction; }
  assert.deepEqual(modes, ['strict']); assert.equal(f.acks, 1);
});

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginCapture, appendCapture, finishCapture, pendingCaptures, readChunk, acknowledgeCapture, queueTransaction } from './queue';
import { claimCapture, touchClaim, releaseClaim, beginPrepared, appendPrepared, finishPrepared, preparedCaptures, preparedChunk, acknowledgePrepared, stagedSummary } from './staging';
import { encodeMp3Set } from '../features/local/audio/mp3';
import { MP3_NAMES } from '../features/local/audio/mp3Types';
import { sha256, encodeBlobChunk, type PreparedAudio } from '../shared/preparedAudio';
import { CHUNK_BYTES } from '../shared/captureFormat';
import { receivePrepared } from '../features/local/spotify/preparedDelivery';
import { getTrack, getPlaybackRecord } from '../features/local/library';
import { savedCollection } from '../features/local/collections';
const audio = { left: Float32Array.from({ length: 6000 }, (_, i) => Math.sin(i * .04) * .2), right: new Float32Array(6000), sampleRate: 44100 };
const encoded = encodeMp3Set(audio, { drums: audio, bass: audio, other: audio, vocals: audio });
async function fixture() {
  const trackId = crypto.randomUUID().replaceAll('-', ''), bytes = new Uint8Array(audio.left.length * 8);
  const metadata = { trackId, trackName: 'Name preserved', trackArtist: 'Artist', trackArtworkSrc: 'https://i.scdn.co/image/test',
    audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes.length,
    captureStartVerified: true, captureEndVerified: true, crop: '0-0',
    collection: { path: `album/${trackId.slice(0, 22)}`, title: 'Album', artwork: 'https://i.scdn.co/image/test', trackIds: [trackId, trackId], complete: true,
      tracks: [0, 1].map(rowIndex => ({ trackId, trackName: 'Name preserved', trackArtist: 'Artist', trackArtworkSrc: 'https://i.scdn.co/image/test', rowIndex })) } };
  const id = await beginCapture(42, metadata, bytes.length);
  await appendCapture(42, id, 0, await encodeBlobChunk(new Blob([bytes]), 0)); await finishCapture(42, id);
  const capture = (await pendingCaptures()).find(c => c.id === id)!;
  const result = await encoded;
  const blobs = new Map<string, Blob>(MP3_NAMES.map(name => [name, result.files[name]]));
  blobs.set('artwork', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  const p: PreparedAudio = { id, capture, metadata: { model: 'test', backend: 'webgpu' }, encoding: result.encoding, files: [] };
  for (const [name, blob] of blobs) p.files.push({ name: name as 'input', bytes: blob.size, sha256: await sha256(blob), type: name === 'artwork' ? blob.type : 'audio/mpeg' });
  return { id, p, blobs, trackId };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  const token = await claimCapture(f.id, 42); assert.ok(token);
  await beginPrepared(f.p, token, 42);
  for (const file of f.p.files) for (let index = 0; index < Math.ceil(file.bytes / CHUNK_BYTES); index++)
    await appendPrepared(f.id, token, 42, file.name, index, await encodeBlobChunk(f.blobs.get(file.name)!, index));
  await finishPrepared(f.id, token, 42);
  return token;
}
const read = async <T>(operation: string, args: Record<string, unknown> = {}): Promise<T> => {
  if (operation === 'prepared-chunk') return await preparedChunk(String(args.id), args.name as 'input', Number(args.index)) as T;
  if (operation === 'ack-prepared') return await acknowledgePrepared(String(args.id)) as T;
  throw new Error(operation);
};
test('processing and importing claims exclude each other, bind ownership and expire safely', async () => {
  const f = await fixture();
  assert.equal(await claimCapture(f.id, 43), null);
  const token = await claimCapture(f.id, 42); assert.ok(token);
  assert.equal(await claimCapture(f.id, 'website'), null);
  await assert.rejects(touchClaim(f.id, token, 43));
  await assert.rejects(readChunk(f.id, 0));
  await assert.rejects(acknowledgeCapture(f.id));
  await queueTransaction(['claims'], 'readwrite', tx => tx.objectStore('claims').put({ id: f.id, token, owner: 42, expires: 0 }));
  const replacement = await claimCapture(f.id, 'website'); assert.ok(replacement);
  await assert.rejects(touchClaim(f.id, token, 42));
  await assert.rejects(acknowledgeCapture(f.id, token));
  await releaseClaim(f.id, token, 42);
  assert.equal(await claimCapture(f.id, 42), null);
  await touchClaim(f.id, replacement, 'website');
  await acknowledgeCapture(f.id, replacement);
});
test('interrupted or corrupt prepared output retains raw recording', async () => {
  const f = await fixture(), token = await claimCapture(f.id, 42); assert.ok(token);
  await beginPrepared(f.p, token, 42);
  await assert.rejects(finishPrepared(f.id, token, 42), /incomplete/);
  assert.ok((await pendingCaptures()).some(c => c.id === f.id));
  for (const file of f.p.files) {
    const bytes = new Uint8Array(await f.blobs.get(file.name)!.arrayBuffer());
    if (file.name === 'input') bytes[100] ^= 1;
    await appendPrepared(f.id, token, 42, file.name, 0, await encodeBlobChunk(new Blob([bytes]), 0));
  }
  await assert.rejects(finishPrepared(f.id, token, 42), /Damaged/);
  assert.ok((await pendingCaptures()).some(c => c.id === f.id));
  await releaseClaim(f.id, token, 42);
  const chunks = await queueTransaction<unknown[]>(['chunks'], 'readonly', (tx, done) => { const r = tx.objectStore('chunks').index('captureId').getAll(`output/${f.id}`); r.onsuccess = () => done(r.result); });
  assert.equal(chunks.length, 0);
});
test('prepared result replaces raw only after validation and imports exact audio/artwork/metadata/order', async () => {
  const f = await fixture(); await upload(f);
  assert.ok(!(await pendingCaptures()).some(c => c.id === f.id));
  assert.equal((await stagedSummary()).find(t => t.id === `spotify-${f.trackId}`)?.status, 'ready');
  let acks = 0;
  await receivePrepared(f.p, async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'ack-prepared') { assert.equal((await getTrack(`spotify-${f.trackId}`))?.status, 'ready'); acks++; }
    return read<T>(op, args);
  });
  assert.equal(acks, 1); assert.ok(!(await preparedCaptures()).some(p => p.id === f.id));
  const track = await getTrack(`spotify-${f.trackId}`), playback = await getPlaybackRecord(`spotify-${f.trackId}`);
  assert.equal(track?.title, 'Name preserved'); assert.equal(track?.artist, 'Artist'); assert.equal(playback.playbackGain, f.p.encoding.gain);
  assert.equal(track?.metadata?.crop, '0-0'); assert.equal((track?.metadata?.separation as { model: string }).model, 'test');
  assert.deepEqual(await playback.artwork!.arrayBuffer(), await f.blobs.get('artwork')!.arrayBuffer());
  for (const name of MP3_NAMES) assert.deepEqual(await playback.files.find(file => file.name === `${name}.mp3`)!.blob!.arrayBuffer(), await f.blobs.get(name)!.arrayBuffer());
  assert.deepEqual((await savedCollection(String((f.p.capture.metadata.collection as { path: string }).path))).trackIds, [f.trackId, f.trackId]);
});
test('interrupted website import resumes committed chunks; lost acknowledgment retries without copying', async () => {
  const f = await fixture(); await upload(f);
  const reads: string[] = []; let broken = true, ackFailure = true;
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'prepared-chunk') { reads.push(String(args.name)); if (broken && args.name === 'drums') throw new Error('Disconnected'); }
    if (op === 'ack-prepared' && ackFailure) throw new Error('Ack lost');
    return read<T>(op, args);
  };
  await assert.rejects(receivePrepared(f.p, request), /Disconnected/);
  assert.equal(await getTrack(`spotify-${f.trackId}`), undefined);
  assert.ok((await preparedCaptures()).some(p => p.id === f.id));
  broken = false;
  await assert.rejects(receivePrepared(f.p, request), /Ack lost/);
  assert.equal(reads.filter(n => n === 'input').length, 1);
  const count = reads.length; ackFailure = false;
  await receivePrepared(f.p, request); assert.equal(reads.length, count);
  assert.ok(!(await preparedCaptures()).some(p => p.id === f.id));
});
test('website commit abort leaves staged source and no ready song or receipt', async () => {
  const f = await fixture(); await upload(f);
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: Parameters<typeof original>) {
    const tx = original.apply(this, args);
    if (this.name === 'ktv420-web-library-v1' && args[1] === 'readwrite' && Array.from(tx.objectStoreNames).includes('audio')) queueMicrotask(() => tx.abort());
    return tx;
  } as typeof original;
  try { await assert.rejects(receivePrepared(f.p, read)); }
  finally { IDBDatabase.prototype.transaction = original; }
  assert.equal(await getTrack(`spotify-${f.trackId}`), undefined);
  assert.ok((await preparedCaptures()).some(p => p.id === f.id));
  await receivePrepared(f.p, read);
  assert.equal((await getTrack(`spotify-${f.trackId}`))?.status, 'ready');
});
test('prepared upload retries are idempotent and changed chunks or altered source metadata are rejected', async () => {
  const f = await fixture(), token = await claimCapture(f.id, 42); assert.ok(token);
  await assert.rejects(beginPrepared({ ...f.p, encoding: { ...f.p.encoding, frames: 1 } }, token, 42), /timing/);
  await assert.rejects(beginPrepared({ ...f.p, capture: { ...f.p.capture, metadata: { ...f.p.capture.metadata, trackName: 'Forged' } } }, token, 42), /source changed/);
  await beginPrepared(f.p, token, 42);
  const data = await encodeBlobChunk(f.blobs.get('input')!, 0);
  await appendPrepared(f.id, token, 42, 'input', 0, data);
  await beginPrepared(f.p, token, 42);
  await appendPrepared(f.id, token, 42, 'input', 0, data);
  const changed = new Uint8Array(await f.blobs.get('input')!.arrayBuffer()); changed[100] ^= 1;
  await assert.rejects(appendPrepared(f.id, token, 42, 'input', 0, await encodeBlobChunk(new Blob([changed]), 0)));
  for (const file of f.p.files.filter(file => file.name !== 'input')) await appendPrepared(f.id, token, 42, file.name, 0, await encodeBlobChunk(f.blobs.get(file.name)!, 0));
  await finishPrepared(f.id, token, 42);
  await finishPrepared(f.id, token, 42); // Lost final response does not re-run or erase output.
  assert.ok((await preparedCaptures()).some(p => p.id === f.id));
});
test('website rejects damaged transfer before ack and can retry from clean temporary storage', async () => {
  const f = await fixture(); await upload(f); let corrupt = true, acks = 0;
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'ack-prepared') acks++;
    if (op === 'prepared-chunk' && args.name === 'input' && corrupt) {
      const bytes = new Uint8Array(await f.blobs.get('input')!.arrayBuffer()); bytes[120] ^= 1;
      return await encodeBlobChunk(new Blob([bytes]), 0) as T;
    }
    return read<T>(op, args);
  };
  await assert.rejects(receivePrepared(f.p, request), /Damaged/); assert.equal(acks, 0);
  assert.ok((await preparedCaptures()).some(p => p.id === f.id));
  corrupt = false; await receivePrepared(f.p, request); assert.equal(acks, 1);
});
test('raw import after an abandoned separation deletes partial extension output only with its acknowledgment', async () => {
  const f = await fixture(), token = await claimCapture(f.id, 42); assert.ok(token);
  await beginPrepared(f.p, token, 42);
  await appendPrepared(f.id, token, 42, 'input', 0, await encodeBlobChunk(f.blobs.get('input')!, 0));
  await queueTransaction(['claims'], 'readwrite', tx => tx.objectStore('claims').put({ id: f.id, token, owner: 42, expires: 0 }));
  const receiver = await claimCapture(f.id, 'website'); assert.ok(receiver);
  await acknowledgeCapture(f.id, receiver);
  const remnants = await queueTransaction<unknown[]>(['chunks'], 'readonly', (tx, done) => { const r = tx.objectStore('chunks').index('captureId').getAll(`output/${f.id}`); r.onsuccess = () => done(r.result); });
  assert.deepEqual(remnants, []);
});
test('acknowledging an old prepared result never deletes a newer capture of the same track', async () => {
  const f = await fixture(); await upload(f);
  const next = await beginCapture(42, f.p.capture.metadata, f.p.capture.expectedBytes);
  await appendCapture(42, next, 0, await encodeBlobChunk(new Blob([new Uint8Array(f.p.capture.expectedBytes)]), 0)); await finishCapture(42, next);
  await receivePrepared(f.p, read);
  assert.ok((await pendingCaptures()).some(c => c.id === next));
});
test('one failed song does not block other prepared imports', async () => {
  const first = await fixture(), second = await fixture(); await upload(first); await upload(second);
  const { drainDeliveries } = await import('../features/local/spotify/delivery');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, run: (lock: unknown) => unknown) => run({}) } });
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'hello') return { stagedAudio: true } as T;
    if (op === 'collections' || op === 'pending') return [] as T;
    if (op === 'prepared') return [first.p, second.p] as T;
    if (op === 'prepared-chunk' && args.id === first.id) throw new Error('First recording unavailable');
    return read<T>(op, args);
  };
  await assert.rejects(drainDeliveries(request), /1 import pending/);
  assert.ok((await preparedCaptures()).some(p => p.id === first.id));
  assert.ok(!(await preparedCaptures()).some(p => p.id === second.id));
  assert.equal((await getTrack(`spotify-${second.trackId}`))?.status, 'ready');
});

test('deletion during a pending import wins durably and discards redundant extension audio', async () => {
  const f = await fixture(); await upload(f);
  const { deleteTrack } = await import('../features/local/library');
  await deleteTrack(`spotify-${f.trackId}`);
  let copied = 0;
  await receivePrepared(f.p, async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'prepared-chunk') copied++;
    if (op === 'ack-prepared') { assert.equal(args.discarded, true); return await acknowledgePrepared(String(args.id), true) as T; }
    return read<T>(op, args);
  });
  assert.equal(copied, 0); assert.equal(await getTrack(`spotify-${f.trackId}`), undefined);
  assert.equal((await stagedSummary(true)).some(t => t.id === `spotify-${f.trackId}`), false);
});
test('a newer capture replaces ready audio and old capture metadata cannot undo newer playlist membership', async () => {
  const f = await fixture(); await upload(f); await receivePrepared(f.p, read);
  const { rememberCollection } = await import('../features/local/collections');
  const collection = f.p.capture.metadata.collection as { path: string; trackIds: string[] };
  await rememberCollection({ ...collection, trackIds: [f.trackId, 'added'], observedAt: Date.now() + 10000 });
  const next = await fixture();
  next.p.capture.metadata = { ...f.p.capture.metadata, trackName: 'New recording' };
  next.p.capture.createdAt = f.p.capture.createdAt + 1;
  await queueTransaction(['captures'], 'readwrite', tx => tx.objectStore('captures').put(next.p.capture));
  await upload(next); await receivePrepared(next.p, read);
  assert.equal((await getTrack(`spotify-${f.trackId}`))?.title, 'New recording');
  assert.deepEqual((await savedCollection(collection.path)).trackIds, [f.trackId, 'added']);
});
test('a stale receipt cannot acknowledge missing audio as successfully imported', async () => {
  const f = await fixture(); await upload(f);
  const { transaction } = await import('../features/local/library');
  await transaction(['receipts'], 'readwrite', tx => tx.objectStore('receipts').put({ id: `prepared/${f.id}`, trackId: `spotify-${f.trackId}` }));
  await receivePrepared(f.p, read);
  assert.equal((await getTrack(`spotify-${f.trackId}`))?.status, 'ready');
});

test('shared-library background migration recovers old prepared audio without any visible website importer', async () => {
  const { migrateLegacyAudio } = await import('../features/local/spotify/sharedMigration');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, fn: (lock: object) => unknown) => fn({}) } });
  const f = await fixture(); await upload(f);
  let imports = 0;
  await migrateLegacyAudio(async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'collections') return [] as T;
    if (op === 'prepared') return [f.p] as T;
    if (op === 'work-pending') return await pendingCaptures() as T;
    if (op === 'ack-prepared') imports++;
    return read<T>(op, args);
  });
  assert.equal(imports, 1);
  assert.equal((await getTrack(`spotify-${f.trackId}`))?.status, 'ready');
  assert.ok(!(await preparedCaptures()).some(p => p.id === f.id));
});

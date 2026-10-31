import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { returnUnfinishedOriginals } from './returnOriginals';
import { transaction, getTrack, getInput } from '../library';
import { beginReturnedCapture, appendReturnedCapture, finishReturnedCapture } from '../../../extension/returnedCapture';
import { pendingCaptures, readChunk } from '../../../extension/queue';
import { CHUNK_BYTES, decodeChunk } from '../../../shared/captureFormat';
import { wavHeader } from '../../../shared/captureWav';
test('interrupted original return resumes exact chunks and never deletes the website backup', async () => {
  const id = 'spotify-returnSong', bytes = CHUNK_BYTES + 8;
  const pcm = new Float32Array(bytes / 4); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i) * .2;
  const metadata = { trackId: 'returnSong', audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes, captureStartVerified: true, captureEndVerified: true };
  const wav = new Blob([wavHeader({ metadata, expectedBytes: bytes }), pcm], { type: 'audio/wav' });
  await transaction(['tracks', 'audio', 'collections'], 'readwrite', tx => {
    tx.objectStore('tracks').put({ id, title: 'Keep me', artist: 'Artist', createdAt: 1, source: 'spotify', status: 'captured', bytes: wav.size, frames: bytes / 8, sampleRate: 44100, metadata });
    tx.objectStore('audio').put({ key: `${id}/input.wav`, trackId: id, name: 'input.wav', blob: wav });
    tx.objectStore('collections').put({ path: 'album/1111111111111111111111', title: 'Album', artwork: '', trackIds: ['returnSong'], complete: true });
  });
  let fail = true; const indexes: number[] = [];
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === 'return-begin') return await beginReturnedCapture(String(args.id), args.metadata as Record<string, unknown>, Number(args.bytes)) as T;
    if (op === 'return-chunk') { indexes.push(Number(args.index)); if (fail && args.index === 1) throw new Error('Disconnected'); return await appendReturnedCapture(String(args.id), Number(args.index), String(args.base64)) as T; }
    if (op === 'return-finish') return await finishReturnedCapture(String(args.id)) as T;
    throw new Error(op);
  };
  await assert.rejects(returnUnfinishedOriginals(request), /Disconnected/);
  assert.equal((await pendingCaptures()).length, 0);
  assert.equal((await getTrack(id))?.metadata?.extensionCaptureId, undefined);
  assert.deepEqual(await (await getInput(id)).arrayBuffer(), await wav.arrayBuffer());
  fail = false; await returnUnfinishedOriginals(request);
  assert.deepEqual(indexes, [0, 1, 1]);
  const capture = (await pendingCaptures())[0]; assert.ok(capture.complete);
  assert.equal((await getTrack(id))?.metadata?.extensionCaptureId, capture.id);
  const restored = new Blob(await Promise.all([0, 1].map(async index => decodeChunk(await readChunk(capture.id, index)))));
  assert.deepEqual(await restored.arrayBuffer(), pcm.buffer);
  await returnUnfinishedOriginals(request); assert.equal((await pendingCaptures()).length, 1); assert.deepEqual(indexes, [0, 1, 1]);
  assert.deepEqual(await (await getInput(id)).arrayBuffer(), await wav.arrayBuffer());
});

test('shared-library recovery never sends an already queued original back to the extension again', async () => {
  const pending = await pendingCaptures();
  assert.ok(pending.length);
  const skip = new Set(pending.map(c => `spotify-${c.metadata.trackId}`));
  await returnUnfinishedOriginals(async () => { throw Error('Duplicate raw transfer'); }, skip);
});

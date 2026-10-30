import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStagedProcessing } from './stagedProcessing';
import { processLocalTrack } from '../processing';
import { encodeMp3Set } from '../audio/mp3';
import { beginCapture, appendCapture, finishCapture, pendingCaptures, readChunk } from '../../../extension/queue';
import { claimCapture, touchClaim, releaseClaim, beginPrepared, appendPrepared, finishPrepared, preparedCaptures } from '../../../extension/staging';
import { encodeBlobChunk } from '../../../shared/preparedAudio';
import type { SeparationResult } from '../inference/types';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
test('hosted worker separates extension-owned input while the next capture can finish, then commits staged MP3s', async () => {
  const frames = 6000, bytes = new Uint8Array(frames * 8), trackId = crypto.randomUUID().replaceAll('-', '');
  const metadata = { trackId, audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes.length, captureStartVerified: true, captureEndVerified: true };
  const id = await beginCapture(90, metadata, bytes.length);
  await appendCapture(90, id, 0, await encodeBlobChunk(new Blob([bytes]), 0)); await finishCapture(90, id);
  const entered = deferred<void>(), finish = deferred<void>(), committed = deferred<void>();
  const errors: string[] = [];
  const request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const captureId = String(args.id), token = String(args.token);
    switch (op) {
      case 'hello': return { stagedAudio: true } as T;
      case 'work-pending': return (await pendingCaptures()).filter(c => c.id === id) as T;
      case 'work-claim': return await claimCapture(captureId, 90) as T;
      case 'work-chunk': return await readChunk(captureId, Number(args.index), token) as T;
      case 'work-touch': return await touchClaim(captureId, token, 90) as T;
      case 'work-begin': return await beginPrepared(args.manifest, token, 90) as T;
      case 'work-append': return await appendPrepared(captureId, token, 90, args.name as 'input', Number(args.index), String(args.base64)) as T;
      case 'work-finish': await finishPrepared(captureId, token, 90); committed.resolve(); return undefined as T;
      case 'work-release': return await releaseClaim(captureId, token, 90) as T;
      default: throw new Error(op);
    }
  };
  const stop = startStagedProcessing(error => errors.push(error), () => {}, {
    request,
    createSeparator: () => ({ dispose() {}, async separateStereo(audio) {
      assert.equal(audio.left.length, frames); assert.equal(audio.sampleRate, 44100);
      entered.resolve(); await finish.promise;
      return { drums: audio, bass: audio, other: audio, vocals: audio, metadata: {} } as SeparationResult;
    } }),
    process: (id, separator, cancelled, progress, storage) => processLocalTrack(id, separator, cancelled, progress, storage, encodeMp3Set),
  });
  try {
    await entered.promise;
    assert.equal(await claimCapture(id, 'website'), null);
    const next = await beginCapture(90, { ...metadata, trackId: `${trackId}next` }, bytes.length);
    await appendCapture(90, next, 0, await encodeBlobChunk(new Blob([bytes]), 0)); await finishCapture(90, next);
    assert.ok((await pendingCaptures()).some(c => c.id === next));
    finish.resolve(); await committed.promise;
    assert.ok((await preparedCaptures()).some(p => p.id === id));
    assert.deepEqual(errors, []);
  } finally { stop(); finish.resolve(); }
});
test('closing overlay cancels inference and releases its raw capture for website import', async () => {
  const bytes = new Uint8Array(16), metadata = { trackId: 'canceltest', audioSampleRate: 44100, audioChannelCount: 2, audioSampleFormat: 'PCM_F32LE', audioByteLength: 16, captureStartVerified: true, captureEndVerified: true };
  const id = await beginCapture(91, metadata, 16); await appendCapture(91, id, 0, await encodeBlobChunk(new Blob([bytes]), 0)); await finishCapture(91, id);
  const entered = deferred<void>(), cancelled = deferred<void>(), released = deferred<void>(); let disposed = false;
  const stop = startStagedProcessing(() => {}, () => {}, {
    request: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      switch (op) {
        case 'hello': return { stagedAudio: true } as T;
        case 'work-pending': return (await pendingCaptures()).filter(c => c.id === id) as T;
        case 'work-claim': return await claimCapture(id, 91) as T;
        case 'work-chunk': return await readChunk(id, Number(args.index), String(args.token)) as T;
        case 'work-release': await releaseClaim(id, String(args.token), 91); released.resolve(); return undefined as T;
        default: throw new Error(op);
      }
    },
    createSeparator: () => ({ dispose() { disposed = true; cancelled.resolve(); }, async separateStereo() { entered.resolve(); await cancelled.promise; throw new Error('Cancelled'); } }),
  });
  await entered.promise; stop(); await released.promise;
  assert.equal(disposed, true);
  assert.ok((await pendingCaptures()).some(c => c.id === id));
  assert.ok(await claimCapture(id, 'website'));
});

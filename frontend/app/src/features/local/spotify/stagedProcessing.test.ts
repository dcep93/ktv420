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

test('startup and a blocked model initialization publish their actual stage immediately', async () => {
  const entered = deferred<void>(), finish = deferred<void>(), released = deferred<void>();
  const startup: string[] = [], remote: string[] = [];
  const stop = startStagedProcessing(error => assert.fail(error), () => {}, {
    request: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (op === 'hello') return { stagedAudio: true, extensionQueue: true, workRecovery: true } as T;
      if (op === 'work-recover') return undefined as T;
      if (op === 'work-state') return { enabled: true, backend: 'auto' } as T;
      if (op === 'work-pending') return [{ id: 'status', metadata: { trackId: 'statusSong' } }] as T;
      if (op === 'work-claim') return 'token' as T;
      if (op === 'work-touch') { remote.push((args.progress as { message: string }).message); return undefined as T; }
      if (op === 'work-release') { released.resolve(); return undefined as T; }
      throw Error(op);
    },
    createSeparator: () => ({ dispose() {}, separateStereo: async () => { throw Error('unused'); } }),
    process: async (_id, _separator, _cancelled, report) => {
      report({ phase: 'loading', fraction: 0, message: 'Initializing GPU model…' });
      entered.resolve(); await finish.promise;
    },
  }, message => startup.push(message));
  try {
    await entered.promise; await new Promise(resolve => setImmediate(resolve));
    assert.ok(startup.includes('Recovering interrupted separation…'));
    assert.ok(startup.includes('Checking saved recordings…'));
    assert.equal(startup.at(-1), '');
    assert.equal(remote[0], 'Starting separation worker…');
    assert.equal(remote.at(-1), 'Initializing GPU model…');
  } finally { stop(); finish.resolve(); await released.promise; }
});

test('startup heals before claiming, and a stopped page releases a late claim without starting inference', async () => {
  const entered = deferred<void>(), claim = deferred<string>(), released = deferred<void>();
  const calls: string[] = [];
  const stop = startStagedProcessing(() => {}, () => {}, {
    request: async <T>(op: string): Promise<T> => {
      calls.push(op);
      if (op === 'hello') return { stagedAudio: true, extensionQueue: true, workRecovery: true } as T;
      if (op === 'work-recover') return undefined as T;
      if (op === 'work-state') return { enabled: true, backend: 'auto' } as T;
      if (op === 'work-pending') return [{ id: 'pending', metadata: { trackId: 'song' } }] as T;
      if (op === 'work-claim') { entered.resolve(); return await claim.promise as T; }
      if (op === 'work-release') { released.resolve(); return undefined as T; }
      throw new Error(op);
    },
    createSeparator: () => { throw new Error('Stopped view must never create a worker'); },
    process: async () => assert.fail('Stopped view must not process'),
  });
  await entered.promise;
  assert.ok(calls.indexOf('work-recover') < calls.indexOf('work-claim'));
  stop(); claim.resolve('token'); await released.promise;
});
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
        case 'work-touch': return undefined as T;
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
test('failed separation identifies the song and releases it without reporting continued progress', async () => {
  const released = deferred<void>();
  const errors: [string, string | undefined][] = [];
  const updates: unknown[] = [];
  const stop = startStagedProcessing((error, id) => errors.push([error, id]), (id, progress) => updates.push([id, progress]), {
    request: async <T>(operation: string): Promise<T> => {
      if (operation === 'hello') return { stagedAudio: true } as T;
      if (operation === 'work-touch') return undefined as T;
      if (operation === 'work-pending') return [{ id: 'failure', metadata: { trackId: 'failedSong' } }] as T;
      if (operation === 'work-claim') return 'token' as T;
      if (operation === 'work-release') { released.resolve(); return undefined as T; }
      throw new Error(operation);
    },
    createSeparator: () => ({ dispose() {}, async separateStereo() { throw new Error('unused'); } }),
    process: async () => { throw new Error('GPU failed'); },
  });
  try {
    await released.promise;
    assert.deepEqual(errors, [['GPU failed', 'failedSong']]);
    assert.deepEqual(updates.at(-1), ['failedSong', null]);
  } finally { stop(); }
});
test('shared queue worker respects pause and resumes without a website-owned raw import', async () => {
  let enabled = false, claimed = 0, polls = 0, saved = false;
  const processed = deferred<void>();
  const stop = startStagedProcessing(() => {}, () => {}, {
    request: async <T>(op: string): Promise<T> => {
      if (op === 'hello') return { stagedAudio: true, extensionQueue: true } as T;
      if (op === 'work-touch') return undefined as T;
      if (op === 'work-state') { polls++; return { enabled, backend: 'auto' } as T; }
      if (op === 'work-pending') return (saved ? [] : [{ id: 'shared', metadata: { trackId: 'sharedSong' } }]) as T;
      if (op === 'work-claim') { claimed++; return 'token' as T; }
      if (op === 'work-release') { processed.resolve(); return undefined as T; }
      throw new Error(op);
    },
    createSeparator: () => ({ dispose() {}, async separateStereo() { throw new Error('unused'); } }),
    process: async () => { saved = true; },
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(polls > 0); assert.equal(claimed, 0);
    enabled = true; await processed.promise; assert.equal(claimed, 1);
  } finally { stop(); }
});

test('sequential songs reuse the model worker and normal view closure does not claim background work', async () => {
  let created = 0, disposed = 0, processed = 0;
  const finished = deferred<void>();
  const stop = startStagedProcessing(error => assert.fail(error), () => {}, {
    request: async <T>(op: string): Promise<T> => {
      if (op === 'hello') return { stagedAudio: true, extensionQueue: true } as T;
      if (op === 'work-state') return { enabled: true, backend: 'auto' } as T;
      if (op === 'work-pending') return [1, 2].map(n => ({ id: String(n), metadata: { trackId: `song${n}` } })) as T;
      if (op === 'work-claim') return 'token' as T;
      if (op === 'work-release') { if (processed === 2) finished.resolve(); return undefined as T; }
      if (op === 'work-touch') return undefined as T;
      throw new Error(op);
    },
    createSeparator: () => { created++; return { dispose: () => { disposed++; }, separateStereo: async () => { throw new Error('unused'); } }; },
    process: async () => { processed++; },
  });
  await finished.promise; assert.equal(created, 1); assert.equal(disposed, 0); stop(); assert.equal(disposed, 1);
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/playlist' } });
  const observed = deferred<void>();
  const stopView = startStagedProcessing(error => assert.fail(error), () => {}, {
    request: async <T>(op: string): Promise<T> => { assert.equal(op, 'hello'); observed.resolve(); return { stagedAudio: true, backgroundQueue: true } as T; },
    createSeparator: () => { throw new Error('Visible view must never own inference'); },
  });
  await observed.promise; stopView();
});

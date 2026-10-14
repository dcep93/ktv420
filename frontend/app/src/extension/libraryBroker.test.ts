import { encodeMp3Set } from '../features/local/audio/mp3';
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryBrokerSession, PROCESSING_PREFERENCE, SEPARATION_LOCK, type BrokerLocks } from './libraryBroker.ts';
import { saveInput, getTrack, getInput, getPlaybackRecord, deleteTrack } from '../features/local/library.ts';
import { encodeFloat32Wav } from '../features/local/audio/wav.ts';

function fixture() {
  let held = false;
  const locks = {
    async request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) {
      assert.equal(name, SEPARATION_LOCK); assert.equal(options.ifAvailable, true);
      if (held) return callback(null);
      held = true;
      try { return await callback({ name, mode: 'exclusive' }); } finally { held = false; }
    },
  } as BrokerLocks;
  const values = new Map<string, string>();
  const preferences = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let serial = 0;
  const create = () => {
    const session = createLibraryBrokerSession({ locks, preferences });
    return { ...session, call: (method: string, ...args: unknown[]) => session.handle({ source: 'ktv420-library', version: 2, id: `req-${++serial}`, method, args }) };
  };
  return { create, values };
}
async function input() {
  const id = crypto.randomUUID();
  const samples = new Float32Array([-0, -1.0001, 0.12345678, 4.321]);
  const wav = new Blob([encodeFloat32Wav({ left: samples, right: samples, sampleRate: 44100 })]);
  await saveInput({ id, title: 'Existing audio', artist: 'Artist', createdAt: 1, frames: samples.length, sampleRate: 44100, status: 'captured', bytes: wav.size, source: 'spotify' }, wav, new Blob(['original source']));
  const encoded=await encodeMp3Set({left:samples,right:samples,sampleRate:44100},{drums:{left:samples,right:samples,sampleRate:44100},bass:{left:samples,right:samples,sampleRate:44100},other:{left:samples,right:samples,sampleRate:44100},vocals:{left:samples,right:samples,sampleRate:44100}});
  return { id, wav, stems:encoded.files, encoding:encoded.encoding, metadata: { inputSampleRate: 44100, inputFrames: samples.length, model: 'test' } };
}

test('raw Float32 is read unchanged and replaced atomically by five MP3s', async () => {
  const { id, wav, stems, metadata, encoding } = await input();
  const session = fixture().create();
  assert.equal((await session.call('listTracks')).ok, true);
  assert.equal(((await session.call('getTrack', id)).result as { title: string }).title, 'Existing audio');
  const result = await session.call('getInput', id);
  assert.deepEqual(await (result.result as Blob).arrayBuffer(), await wav.arrayBuffer());
  assert.equal((await session.call('acquireLock')).result, true);
  assert.equal((await session.call('saveMp3', id, stems, metadata, encoding)).ok, true);
  assert.equal((await getTrack(id))?.status, 'ready');
  const playback = await getPlaybackRecord(id);
  assert.equal(playback.files.length, 5);
  assert.equal(playback.playbackGain, encoding.gain);
  assert.ok(playback.files.every(file => file.name.endsWith('.mp3')));
  assert.ok(playback.files.find(file => file.name === 'input.mp3')?.path.includes('/input/'));
  assert.equal((await getTrack(id))?.bytes, Object.values(stems).reduce((total, blob) => total + blob.size, 0));
  await assert.rejects(getInput(id));
  await session.dispose(); await deleteTrack(id);
});

test('serialized lock acquisition, nonowner mutations, deletion contention and interrupted release', async () => {
  const { create } = fixture(), owner = create(), other = create();
  const { id, stems, metadata, encoding } = await input();
  assert.equal((await other.call('setTrackStatus', id, 'processing')).ok, false);
  assert.equal((await owner.call('acquireLock')).result, true);
  assert.equal((await other.call('acquireLock')).result, false);
  assert.equal((await other.call('saveMp3', id, stems, metadata, encoding)).ok, false);
  assert.equal((await owner.call('deleteTrack', id)).ok, false);
  assert.equal((await other.call('deleteTrack', id)).ok, false);
  assert.equal((await owner.call('setTrackStatus', id, 'processing')).ok, true);
  await owner.dispose();
  assert.equal((await owner.call('acquireLock')).ok, false);
  const [lock, write] = await Promise.all([other.call('acquireLock'), other.call('setTrackStatus', id, 'captured')]);
  assert.equal(lock.result, true); assert.equal(write.ok, true);
  await other.call('releaseLock');
  assert.equal((await other.call('deleteTrack', id)).ok, true);
  await other.dispose();
});

test('pause preference is shared and preserves existing enabled/paused representation', async () => {
  const { create, values } = fixture(), first = create(), second = create();
  values.set(PROCESSING_PREFERENCE, 'paused');
  assert.equal((await first.call('getProcessingEnabled')).result, false);
  await first.call('setProcessingEnabled', true);
  assert.equal(values.get(PROCESSING_PREFERENCE), 'enabled');
  assert.equal((await second.call('getProcessingEnabled')).result, true);
  assert.equal((await second.call('setProcessingEnabled', 'false')).ok, false);
  await first.dispose(); await second.dispose();
});

test('invalid requests, metadata, incomplete/nonfinite/PCM/wrong-length stems never publish partial output', async () => {
  const { id, wav, stems, metadata, encoding } = await input(), session = fixture().create();
  const request = { source: 'ktv420-library', version: 2, id: 'test', method: 'listTracks', args: [] };
  for (const invalid of [null, {}, { ...request, version: 1 }, { ...request, id: 'x'.repeat(129) },
    { ...request, method: 'fetch', args: ['https://example.com'] }, { ...request, method: 'constructor' },
    { ...request, args: [1] }, { ...request, args: 'wrong' }]) {
    assert.equal((await session.handle(invalid)).ok, false);
  }
  assert.match((await session.handle({ ...request, version: 1 })).error!, /version mismatch/);
  await session.call('acquireLock');
  assert.equal((await session.call('setTrackStatus', id, 'ready')).ok, false);
  const nonfinite = await wav.arrayBuffer(); new DataView(nonfinite).setFloat32(58, NaN, true);
  const pcm = await wav.arrayBuffer(); new DataView(pcm).setUint16(20, 1, true);
  const short = new Blob([encodeFloat32Wav({ left: new Float32Array(1), right: new Float32Array(1), sampleRate: 44100 })]);
  for (const [badStems, badMetadata] of [
    [{ drums: wav }, metadata], [{ ...stems, extra: wav }, metadata],
    [{ ...stems, vocals: new Blob([nonfinite]) }, metadata], [{ ...stems, vocals: new Blob([pcm]) }, metadata],
    [{ ...stems, vocals: short }, metadata], [{ ...stems, vocals: new Blob(['broken']) }, metadata],
    [stems, { ...metadata, inputFrames: 10 }], [stems, { ...metadata, inputSampleRate: 48000 }],
    [stems, { ...metadata, bad: Infinity }], [stems, { ...metadata, large: 'x'.repeat(4097) }],
  ]) {
    assert.equal((await session.call('saveMp3', id, badStems, badMetadata, encoding)).ok, false);
    assert.equal((await getTrack(id))?.status, 'captured');
    assert.equal((await getPlaybackRecord(id)).files.length, 2);
  }
  await session.dispose(); await deleteTrack(id);
});

test('disposal during a pending acquisition cannot leave a worker lock held', async () => {
  const { create } = fixture(), first = create(), second = create();
  const request = first.call('acquireLock');
  await first.dispose(); await request;
  assert.equal((await second.call('acquireLock')).result, true);
  await second.dispose();
});

test('queued RPC count is bounded and recovers after draining', async () => {
  const session = fixture().create();
  const responses = await Promise.all(Array.from({ length: 20 }, () => session.call('getProcessingEnabled')));
  assert.equal(responses.filter(response => response.ok).length, 16);
  assert.equal(responses.filter(response => !response.ok && response.error?.includes('pending')).length, 4);
  assert.equal((await session.call('getProcessingEnabled')).ok, true);
  await session.dispose();
});

test('multiline inference errors persist as retryable failures while IDs and error lengths remain bounded', async () => {
  const { id } = await input(), session = fixture().create();
  await session.call('acquireLock');
  await session.call('setTrackStatus', id, 'processing');
  const error = 'Inference failed:\nModel execution stopped.\r\nRetry this track.';
  assert.equal((await session.call('setTrackStatus', id, 'error', error)).ok, true);
  assert.equal((await getTrack(id))?.status, 'error');
  assert.equal((await getTrack(id))?.error, error);
  assert.equal((await session.call('setTrackStatus', id, 'error', 'x'.repeat(4097))).ok, false);
  assert.equal((await session.call('getTrack', `${id}\n`)).ok, false);
  assert.equal((await session.call('setTrackStatus', id, 'captured')).ok, true);
  assert.equal((await getTrack(id))?.status, 'captured');
  assert.equal((await getTrack(id))?.error, undefined);
  await session.dispose(); await deleteTrack(id);
});

test('invalid encoding gain/rate/length and old WAV commits are rejected without touching raw input',async()=>{
 const {id,wav,stems,metadata,encoding}=await input(),session=fixture().create();
 await session.call('acquireLock');
 for(const bad of [{...encoding,gain:0},{...encoding,gain:Infinity},{...encoding,gain:1.1},{...encoding,sampleRate:48000},{...encoding,frames:9},{...encoding,extra:true}]){
  assert.equal((await session.call('saveMp3',id,stems,metadata,bad)).ok,false);
 }
 assert.equal((await session.call('saveStems',id,stems,metadata)).ok,false);
 assert.deepEqual(await (await getInput(id)).arrayBuffer(),await wav.arrayBuffer());
 await session.dispose();await deleteTrack(id);
});

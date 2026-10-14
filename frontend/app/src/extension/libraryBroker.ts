import { validateMp3 } from './mp3Validation';
import { MP3_NAMES, mp3Layout, type Mp3Files, type Mp3Encoding } from '../features/local/audio/mp3Types';
import * as library from '../features/local/library';

export const LIBRARY_PROTOCOL_VERSION = 2;
export const SEPARATION_LOCK = 'ktv420-separation';
export const PROCESSING_PREFERENCE = 'ktv420-auto-processing';
export type BrokerResponse = {
  source: 'ktv420-library'; version: 2; id: string; ok: boolean; result?: unknown; error?: string;
};
export type BrokerLocks = Pick<LockManager, 'request'>;
type Preferences = Pick<Storage, 'getItem' | 'setItem'>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function boundedString(value: unknown, label: string, max = 256, multiline = false): string {
  if (typeof value !== 'string' || !value.length || value.length > max || [...value].some(char =>
    char.charCodeAt(0) < 32 && !(multiline && (char === '\n' || char === '\r')))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}
function metadataValue(value: unknown, depth = 0, budget = { remaining: 4096 }): void {
  if (--budget.remaining < 0) throw new Error('Separation metadata is too large.');
  if (depth > 6) throw new Error('Metadata is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 4096 ||
    typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value) && value.length <= 64) { value.forEach(item => metadataValue(item, depth + 1, budget)); return; }
  if (record(value) && Object.keys(value).length <= 64) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid metadata key.');
      metadataValue(item, depth + 1, budget);
    }
    return;
  }
  throw new Error('Invalid metadata value.');
}

/** One trusted hosted frame owns one serialized session. Its lock never crosses origins. */
export function createLibraryBrokerSession(options: { locks: BrokerLocks; preferences: Preferences }) {
  let closed = false, release: (() => void) | undefined, holding: Promise<unknown> | undefined, pending = 0;
  let queue: Promise<unknown> = Promise.resolve();
  function assertOpen() { if (closed) throw new Error('Library session has closed. Reload the player.'); }
  function assertOwner() { assertOpen(); if (!release) throw new Error('Acquire the separation lock before writing processing results.'); }
  async function releaseLock() {
    const pending = holding;
    release?.(); release = undefined;
    await pending;
  }
  async function acquireLock(): Promise<boolean> {
    assertOpen();
    if (release) return true;
    return new Promise<boolean>((resolve, reject) => {
      holding = options.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
        if (!lock || closed) { resolve(false); return; }
        await new Promise<void>(unlock => { release = unlock; resolve(true); });
      });
      holding.catch(reject);
    });
  }
  async function execute(method: string, args: unknown[]) {
    assertOpen();
    const counts: Record<string, number[]> = {
      listTracks: [0], getTrack: [1], getInput: [1], getPlaybackRecord: [1],
      setTrackStatus: [2, 3], saveMp3: [4], deleteTrack: [1], getProcessingEnabled: [0],
      setProcessingEnabled: [1], acquireLock: [0], releaseLock: [0],
    };
    if (!Object.hasOwn(counts, method)) throw new Error(`Unsupported library operation: ${method}.`);
    if (!counts[method].includes(args.length)) throw new Error('Invalid argument count.');
    if (method === 'acquireLock') return acquireLock();
    if (method === 'releaseLock') return releaseLock();
    if (method === 'getProcessingEnabled') return options.preferences.getItem(PROCESSING_PREFERENCE) !== 'paused';
    if (method === 'setProcessingEnabled') {
      if (typeof args[0] !== 'boolean') throw new Error('Processing preference must be a boolean.');
      options.preferences.setItem(PROCESSING_PREFERENCE, args[0] ? 'enabled' : 'paused'); return;
    }
    if (method === 'listTracks') return library.listTracks();
    const id = boundedString(args[0], 'track ID');
    if (method === 'getTrack') return library.getTrack(id);
    if (method === 'getInput') return library.getInput(id);
    if (method === 'getPlaybackRecord') return library.getPlaybackRecord(id);
    if (method === 'deleteTrack') {
      return options.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
        assertOpen();
        if (!lock) throw new Error('Stop processing before deleting a track.');
        await library.deleteTrack(id);
      });
    }
    assertOwner();
    const track = await library.getTrack(id);
    if (!track) throw new Error('Track no longer exists.');
    if (method === 'setTrackStatus') {
      const status = args[1];
      if (status !== 'captured' && status !== 'processing' && status !== 'error') throw new Error('Invalid processing status. Ready requires a complete stem commit.');
      const error = args[2] === undefined ? undefined : boundedString(args[2], 'processing error', 4096, true);
      assertOwner();
      return library.setTrackStatus(id, status, error);
    }
    const files = args[1], metadata = args[2], encoding = args[3];
    if (!record(files) || Object.keys(files).length !== 5 || !MP3_NAMES.every(name => Object.hasOwn(files, name))) throw new Error('Exactly five MP3 files are required: input, drums, bass, other, vocals.');
    if (!record(metadata)) throw new Error('Invalid separation metadata.');
    metadataValue(metadata);
    if (JSON.stringify(metadata).length > 16384) throw new Error('Separation metadata is too large.');
    if (metadata.inputSampleRate !== track.sampleRate || metadata.inputFrames !== track.frames) throw new Error('Separation metadata does not match the original audio.');
    if (!Number.isInteger(track.sampleRate) || track.sampleRate < 8000 || track.sampleRate > 384000 || !Number.isSafeInteger(track.frames) || track.frames <= 0 || track.frames * 4 > 1024 ** 3) throw new Error('Original audio metadata is invalid.');
    const expected = mp3Layout(track.sampleRate, track.frames);
    if (!record(encoding) || Object.keys(encoding).length !== 3 || encoding.sampleRate !== expected.sampleRate || encoding.frames !== expected.frames ||
      typeof encoding.gain !== 'number' || !Number.isFinite(encoding.gain) || encoding.gain <= 0 || encoding.gain > 1) throw new Error('Invalid MP3 encoding metadata or gain.');
    // One bounded file at a time; storage is untouched until all five validate.
    for (const name of MP3_NAMES) await validateMp3(files[name], expected.sampleRate, expected.frames);
    assertOwner();
    return library.saveMp3(id, files as Mp3Files, metadata, encoding as Mp3Encoding);
  }
  async function dispatch(value: unknown): Promise<BrokerResponse> {
    const id = record(value) && typeof value.id === 'string' && value.id.length <= 128 ? value.id : '';
    const base = { source: 'ktv420-library' as const, version: 2 as const, id };
    try {
      if (!record(value) || value.source !== 'ktv420-library') throw new Error('Invalid library request.');
      if (value.version !== LIBRARY_PROTOCOL_VERSION) throw new Error('Library bridge version mismatch. Update the extension and reload the player.');
      boundedString(value.id, 'request ID', 128);
      const method = boundedString(value.method, 'operation', 64);
      if (!Array.isArray(value.args) || value.args.length > 4) throw new Error('Invalid request arguments.');
      return { ...base, ok: true, result: await execute(method, value.args) };
    } catch (error) { return { ...base, ok: false, error: error instanceof Error ? error.message : 'Local library operation failed.' }; }
  }
  return {
    handle(value: unknown): Promise<BrokerResponse> {
      if (pending >= 16) return Promise.resolve({ source: 'ktv420-library', version: 2,
        id: record(value) && typeof value.id === 'string' && value.id.length <= 128 ? value.id : '',
        ok: false, error: 'Too many pending library requests. Try again after the current operation.' });
      pending++;
      const result = queue.then(() => dispatch(value));
      queue = result.then(() => { pending--; }, () => { pending--; });
      return result;
    },
    async dispose(): Promise<void> { closed = true; await queue; await releaseLock(); },
  };
}

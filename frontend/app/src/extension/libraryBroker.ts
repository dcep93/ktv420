import * as library from '../features/local/library';

export const LIBRARY_PROTOCOL_VERSION = 1;
export const SEPARATION_LOCK = 'ktv420-separation';
export const PROCESSING_PREFERENCE = 'ktv420-auto-processing';
// Capture accepts 512 MiB of mono samples; stereo stems can double that payload.
// Reserve bounded WAV header space in addition to the largest stereo payload.
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024 + 65536;
export type BrokerResponse = {
  source: 'ktv420-library'; version: 1; id: string; ok: boolean; result?: unknown; error?: string;
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

/** Validate in place without decoding, quantizing, or copying Float32 samples into channels. */
async function validateStem(blob: unknown, sampleRate: number, frames: number): Promise<void> {
  if (!(blob instanceof Blob) || blob.size < 44 || blob.size > Math.min(MAX_AUDIO_BYTES, frames * 8 + 65536)) throw new Error('Invalid or oversized stem Blob.');
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error('Invalid stem WAV container.');
  let fmt = -1, fmtSize = 0, data = -1, dataSize = 0;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error('Truncated stem WAV chunk.');
    const size = view.getUint32(offset + 4, true), next = offset + 8 + size + size % 2;
    if (next > bytes.byteLength) throw new Error('Truncated stem WAV data.');
    if (tag(offset) === 'fmt ') {
      if (fmt !== -1) throw new Error('Duplicate stem WAV format.');
      fmt = offset + 8; fmtSize = size;
    }
    if (tag(offset) === 'data') {
      if (data !== -1) throw new Error('Duplicate stem WAV data.');
      data = offset + 8; dataSize = size;
    }
    offset = next;
  }
  if (fmt < 0 || fmtSize < 16 || data < 0 || view.getUint16(fmt, true) !== 3 ||
    view.getUint16(fmt + 2, true) !== 2 || view.getUint16(fmt + 14, true) !== 32 ||
    view.getUint16(fmt + 12, true) !== 8 || view.getUint32(fmt + 8, true) !== sampleRate * 8 ||
    view.getUint32(fmt + 4, true) !== sampleRate || dataSize !== frames * 8) {
    throw new Error('Stems must be stereo Float32 WAV with the original sample rate and frame count.');
  }
  for (let offset = data; offset < data + dataSize; offset += 4) {
    if (!Number.isFinite(view.getFloat32(offset, true))) throw new Error('Stem contains non-finite samples.');
  }
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
      setTrackStatus: [2, 3], saveStems: [3], deleteTrack: [1], getProcessingEnabled: [0],
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
    const stems = args[1], metadata = args[2];
    if (!record(stems) || Object.keys(stems).length !== 4 || !library.STEM_NAMES.every(name => Object.hasOwn(stems, name))) throw new Error('Exactly four stems are required: drums, bass, other, vocals.');
    if (!record(metadata)) throw new Error('Invalid separation metadata.');
    metadataValue(metadata);
    if (JSON.stringify(metadata).length > 16384) throw new Error('Separation metadata is too large.');
    if (metadata.inputSampleRate !== track.sampleRate || metadata.inputFrames !== track.frames) throw new Error('Separation metadata does not match the original audio.');
    if (!Number.isInteger(track.sampleRate) || track.sampleRate < 8000 || track.sampleRate > 384000 || !Number.isSafeInteger(track.frames) || track.frames <= 0) throw new Error('Original audio metadata is invalid.');
    // Validate sequentially to bound peak memory to one stem, then commit all four atomically.
    for (const name of library.STEM_NAMES) await validateStem(stems[name], track.sampleRate, track.frames);
    assertOwner();
    return library.saveStems(id, stems as Record<typeof library.STEM_NAMES[number], Blob>, metadata);
  }
  async function dispatch(value: unknown): Promise<BrokerResponse> {
    const id = record(value) && typeof value.id === 'string' && value.id.length <= 128 ? value.id : '';
    const base = { source: 'ktv420-library' as const, version: 1 as const, id };
    try {
      if (!record(value) || value.source !== 'ktv420-library') throw new Error('Invalid library request.');
      if (value.version !== LIBRARY_PROTOCOL_VERSION) throw new Error('Library bridge version mismatch. Update the extension and reload the player.');
      boundedString(value.id, 'request ID', 128);
      const method = boundedString(value.method, 'operation', 64);
      if (!Array.isArray(value.args) || value.args.length > 3) throw new Error('Invalid request arguments.');
      return { ...base, ok: true, result: await execute(method, value.args) };
    } catch (error) { return { ...base, ok: false, error: error instanceof Error ? error.message : 'Local library operation failed.' }; }
  }
  return {
    handle(value: unknown): Promise<BrokerResponse> {
      if (pending >= 16) return Promise.resolve({ source: 'ktv420-library', version: 1,
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

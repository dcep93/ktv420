import { transaction, saveInput, type CaptureSession } from '../features/local/library';
import { encodeFloat32Wav } from '../features/local/audio/wav';

const MAX_BYTES = 512 * 1024 * 1024;
const MAX_CHUNK = 256 * 1024;
function requireMetadata(metadata: Record<string, unknown>, expectedBytes: number) {
  if (!metadata || typeof metadata !== 'object' || typeof metadata.trackId !== 'string' ||
    !/^[A-Za-z0-9]{1,100}$/.test(metadata.trackId) ||
    !Number.isInteger(metadata.audioSampleRate) || Number(metadata.audioSampleRate) < 8000 || Number(metadata.audioSampleRate) > 192000 ||
    ![1, 2].includes(Number(metadata.audioChannelCount)) || metadata.audioSampleFormat !== 'PCM_F32LE' ||
    !Number.isInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_BYTES ||
    expectedBytes % (Number(metadata.audioChannelCount) * 4) !== 0 || metadata.audioByteLength !== expectedBytes) {
    throw new Error('Invalid Float32 capture format or size (maximum 512 MiB per track).');
  }
}
export async function beginCapture(tabId: number, metadata: Record<string, unknown>, expectedBytes: number): Promise<string> {
  requireMetadata(metadata, expectedBytes);
  const id = crypto.randomUUID();
  // Staging belongs to the sender tab, survives service-worker suspension, and is replaced on retry.
  await transaction(['captures', 'chunks'], 'readwrite', tx => {
    const cursorRequest = tx.objectStore('captures').openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const old = cursor.value as CaptureSession;
      if (old.id !== id && (old.tabId === tabId || Date.now() - old.createdAt > 86400000)) {
        tx.objectStore('captures').delete(old.id);
        const chunks = tx.objectStore('chunks').index('captureId').openKeyCursor(IDBKeyRange.only(old.id));
        chunks.onsuccess = () => { const item = chunks.result; if (item) { tx.objectStore('chunks').delete(item.primaryKey); item.continue(); } };
      }
      cursor.continue();
    };
    tx.objectStore('captures').add({ id, tabId, metadata, expectedBytes, receivedBytes: 0, nextChunk: 0, createdAt: Date.now() } satisfies CaptureSession);
  });
  return id;
}
export function appendCapture(tabId: number, id: string, index: number, base64: string): Promise<void> {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_CHUNK / 3) * 4 || !Number.isSafeInteger(index) || index < 0) {
    throw new Error('Invalid capture chunk.');
  }
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_CHUNK) throw new Error('Empty or oversized capture chunk.');
  return transaction(['captures', 'chunks'], 'readwrite', tx => {
    const store = tx.objectStore('captures'); const request = store.get(id);
    request.onsuccess = () => {
      const capture = request.result as CaptureSession | undefined;
      if (!capture || capture.tabId !== tabId || capture.nextChunk !== index || capture.receivedBytes + bytes.length > capture.expectedBytes) { tx.abort(); return; }
      tx.objectStore('chunks').add({ key: `${id}/${index}`, captureId: id, index, bytes });
      store.put({ ...capture, nextChunk: index + 1, receivedBytes: capture.receivedBytes + bytes.length });
    };
  });
}
export async function finishCapture(tabId: number, id: string): Promise<void> {
  const { capture, chunks } = await transaction<{ capture: CaptureSession; chunks: {index: number; bytes: Uint8Array}[] }>(['captures', 'chunks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('captures').get(id);
    request.onsuccess = () => {
      const capture = request.result as CaptureSession | undefined;
      if (!capture || capture.tabId !== tabId || capture.receivedBytes !== capture.expectedBytes) { tx.abort(); return; }
      const chunkRequest = tx.objectStore('chunks').index('captureId').getAll(id);
      chunkRequest.onsuccess = () => done({ capture, chunks: chunkRequest.result });
    };
  });
  chunks.sort((a, b) => a.index - b.index);
  const bytes = new Uint8Array(capture.expectedBytes); let offset = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.index !== index) throw new Error('Capture is incomplete. Retry this track.');
    bytes.set(chunk.bytes, offset); offset += chunk.bytes.length;
  }
  if (offset !== capture.expectedBytes) throw new Error('Capture byte count does not match.');
  const channels = Number(capture.metadata.audioChannelCount);
  const frames = bytes.length / (channels * 4); const sampleRate = Number(capture.metadata.audioSampleRate);
  const left = new Float32Array(frames); const right = new Float32Array(frames); const data = new DataView(bytes.buffer);
  for (let i = 0; i < frames; i++) {
    left[i] = data.getFloat32(i * channels * 4, true);
    right[i] = data.getFloat32((i * channels + channels - 1) * 4, true);
  }
  const wav = new Blob([encodeFloat32Wav({ left, right, sampleRate }, channels as 1 | 2)], { type: 'audio/wav' });
  await saveInput({ id: `spotify-${capture.metadata.trackId}`, title: String(capture.metadata.trackName || 'Spotify capture'),
    artist: String(capture.metadata.trackArtist || ''), createdAt: Date.now(), source: 'spotify', sampleRate, frames,
    status: 'captured', bytes: wav.size, metadata: capture.metadata }, wav);
  await transaction(['captures', 'chunks'], 'readwrite', tx => {
    tx.objectStore('captures').delete(id);
    for (const chunk of chunks) tx.objectStore('chunks').delete(`${id}/${chunk.index}`);
  });
}

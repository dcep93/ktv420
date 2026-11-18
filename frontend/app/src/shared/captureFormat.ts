export const CHUNK_BYTES = 256 * 1024;
export type QueuedCapture = {
  id: string;
  tabId: number;
  documentId?: string;
  metadata: Record<string, unknown>;
  expectedBytes: number;
  receivedBytes: number;
  nextChunk: number;
  createdAt: number;
  complete: boolean;
  streaming?: boolean;
  processingError?: string;
  retryAt?: number;
  attempts?: number;
  recoveries?: number;
  retryAfterReload?: { owner: string; documentId: string };
};
export function validateCapture(metadata: Record<string, unknown>, bytes: number, requireEnd = true) {
  if (
    !metadata ||
    typeof metadata.trackId !== 'string' ||
    !/^[A-Za-z0-9]{1,100}$/.test(metadata.trackId) ||
    !Number.isInteger(metadata.audioSampleRate) ||
    Number(metadata.audioSampleRate) < 8000 ||
    Number(metadata.audioSampleRate) > 192000 ||
    ![1, 2].includes(Number(metadata.audioChannelCount)) ||
    metadata.audioSampleFormat !== 'PCM_F32LE' ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > 1024 ** 3 ||
    bytes % (Number(metadata.audioChannelCount) * 4) !== 0 ||
    metadata.audioByteLength !== bytes ||
    metadata.captureStartVerified !== true ||
    (requireEnd && metadata.captureEndVerified !== true)
  )
    throw new Error('Invalid or unverified capture.');
}
export function decodeChunk(base64: unknown) {
  if (
    typeof base64 !== 'string' ||
    base64.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
    !base64.length ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new Error('Invalid capture chunk.');
  const binary = atob(base64);
  // TypedArray.from iterates the string and allocates an intermediate list.
  // Hundreds of raw-audio chunks made that conversion stall playlist handoff.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length || bytes.length > CHUNK_BYTES) throw new Error('Invalid capture chunk size.');
  return bytes;
}

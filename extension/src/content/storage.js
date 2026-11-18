import { bytesToBase64 } from './capture.js';
import { IncrementalMd5 } from './md5.js';

export async function sendLocalMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'ktv420 extension is unavailable. Reload Spotify after updating it.');
  return response.result;
}
export async function readCachedTracks(trackIds) {
  const requested = new Set(trackIds);
  const records = await sendLocalMessage({ type: 'ktv420:cached' });
  return new Map(records.filter(record => record && requested.has(record.trackId)).map(record => [record.trackId, record]));
}
export async function writeTrackArtifact(trackId, bytes, metadata) {
  if (trackId !== metadata.trackId) throw new Error('Capture track identity mismatch.');
  const id = await sendLocalMessage({ type: 'ktv420:capture-begin', metadata, bytes: bytes.byteLength });
  const chunkSize = 256 * 1024;
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkSize, index++) {
    await sendLocalMessage({ type: 'ktv420:capture-chunk', id, index, base64: bytesToBase64(bytes.subarray(offset, offset + chunkSize)) });
  }
  await sendLocalMessage({ type: 'ktv420:capture-finish', id });
}

/** One bounded chunk at a time while playback continues; publication requires final verification. */
export function createStreamingArtifact(metadata, send = sendLocalMessage) {
  let id, index = 0, offset = 0;
  const hash = new IncrementalMd5();
  return {
    get offset() { return offset; },
    get md5() { return hash.hex(); },
    async append(bytes) {
      if (!bytes.length) return;
      id ??= await send({ type: 'ktv420:capture-stream-begin', metadata });
      for (let start = 0; start < bytes.length; start += 256 * 1024) {
        const part = bytes.subarray(start, start + 256 * 1024);
        await send({ type: 'ktv420:capture-chunk', id, index, base64: bytesToBase64(part) });
        hash.update(part); offset += part.length; index++;
      }
    },
    async finish(finalMetadata) {
      if (!id || offset !== finalMetadata.audioByteLength) throw new Error('Captured audio delivery is incomplete.');
      await send({ type: 'ktv420:capture-stream-finish', id, metadata: finalMetadata, bytes: offset });
    },
  };
}

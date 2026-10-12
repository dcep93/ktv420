import { bytesToBase64 } from './capture.js';

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

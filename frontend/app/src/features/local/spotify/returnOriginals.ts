import { getInput, listTracks, transaction } from '../library';
import { listCollections } from '../collections';
import { validateCapture, CHUNK_BYTES } from '../../../shared/captureFormat';
import { wavHeader } from '../../../shared/captureWav';
import { encodeBlobChunk } from '../../../shared/preparedAudio';
import { spotifyRequest } from './client';
type ReturnJob = { id: string; metadata: Record<string, unknown>; bytes: number };
/** Caller holds delivery + website processing locks. Keep the backup until prepared import commits. */
export async function returnUnfinishedOriginals(request = spotifyRequest, skip = new Set<string>()) {
  const collections = await listCollections();
  const failures: string[] = [];
  for (const track of await listTracks()) {
    if (track.source !== 'spotify' || track.status === 'ready' || skip.has(track.id)) continue;
    try {
      const key = `extension-return/${track.id}`;
      const job = await transaction<ReturnJob>(['settings'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('settings'), r = store.get(key);
        r.onsuccess = () => {
          if (r.result) { done(r.result); return; }
          const collection = collections.find(c => c.trackIds.includes(track.id.replace(/^spotify-/, '')));
          if (!collection) { tx.abort(); return; }
          const metadata = { ...track.metadata, trackName: track.title, trackArtist: track.artist, collection };
          const value = { id: crypto.randomUUID(), metadata, bytes: Number(track.metadata?.audioByteLength) };
          store.put(value, key); done(value);
        };
      });
      validateCapture(job.metadata, job.bytes);
      const input = await getInput(track.id);
      // These originals came from the former byte-exact receiver (58-byte float WAV header).
      const expected = new Uint8Array(wavHeader({ metadata: job.metadata, expectedBytes: job.bytes }));
      const header = new Uint8Array(await input.slice(0, expected.length).arrayBuffer());
      if (input.size !== expected.length + job.bytes || header.length !== expected.length || header.some((v, i) => v !== expected[i]))
        throw new Error(`Cannot return ${track.title}: original format differs. The saved audio is unchanged.`);
      const state = await request<{ complete: boolean; nextChunk: number }>('return-begin', job);
      if (!state.complete) {
        const pcm = input.slice(expected.length);
        for (let index = state.nextChunk; index < Math.ceil(job.bytes / CHUNK_BYTES); index++)
          await request('return-chunk', { id: job.id, index, base64: await encodeBlobChunk(pcm, index) });
        await request('return-finish', { id: job.id });
      }
      await transaction(['tracks'], 'readwrite', tx => {
        const store = tx.objectStore('tracks'), r = store.get(track.id);
        r.onsuccess = () => { if (r.result && r.result.status !== 'ready') store.put({ ...r.result, status: 'captured', error: undefined,
          metadata: { ...r.result.metadata, extensionCaptureId: job.id } }); };
      }, { durability: 'strict' });
    } catch (reason) { failures.push(`${track.title}: ${reason instanceof Error ? reason.message : String(reason)}`); }
  }
  if (failures.length) throw new Error(`Original recovery pending: ${failures.join('; ')}`);
}

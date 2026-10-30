import { returnUnfinishedOriginals } from './returnOriginals';
import { receivePrepared } from './preparedDelivery';
import type { PreparedAudio } from '../../../shared/preparedAudio';
import { SEPARATION_LOCK } from '../libraryClient';
import { wavHeader } from '../../../shared/captureWav';
import { transaction, type LocalTrack } from '../library';
import { parseCollection } from '../savedCollections';
import { decodeChunk, validateCapture, type QueuedCapture } from '../../../shared/captureFormat';
import { spotifyRequest } from './client';
import { embeddedSpotify } from './overlay';
import { rememberCollection, type LibraryCollection } from '../collections';

type Stage = { id: string; nextChunk: number; receivedBytes: number; expectedBytes: number };
export async function receiveCapture(capture: QueuedCapture, request = spotifyRequest) {
  validateCapture(capture.metadata, capture.expectedBytes);
  if (
    !capture.complete ||
    !Number.isSafeInteger(capture.nextChunk) ||
    capture.nextChunk < 1 ||
    capture.nextChunk > 4096 ||
    capture.receivedBytes !== capture.expectedBytes
  )
    throw new Error('Incomplete delivery.');
  const receipt = await transaction<boolean>(['receipts'], 'readonly', (tx, done) => {
    const r = tx.objectStore('receipts').get(capture.id);
    r.onsuccess = () => done(!!r.result);
  });
  if (receipt) {
    await request('ack', { id: capture.id });
    return;
  }
  let stage = await transaction<Stage>(['captures'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('captures'),
      r = store.get(capture.id);
    r.onsuccess = () => {
      const value = r.result || {
        id: capture.id,
        nextChunk: 0,
        receivedBytes: 0,
        expectedBytes: capture.expectedBytes,
      };
      if (value.expectedBytes !== capture.expectedBytes) {
        tx.abort();
        return;
      }
      store.put(value);
      done(value);
    };
  });
  for (let index = stage.nextChunk; index < capture.nextChunk; index++) {
    // One bounded request and one committed chunk at a time is the backpressure boundary.
    const bytes = decodeChunk(await request<string>('chunk', { id: capture.id, index }));
    const words = new DataView(bytes.buffer);
    if (bytes.length % 4) throw new Error('Misaligned PCM.');
    for (let i = 0; i < bytes.length; i += 4)
      if (!Number.isFinite(words.getFloat32(i, true)))
        throw new Error('Non-finite captured audio.');
    const next = {
      ...stage,
      nextChunk: index + 1,
      receivedBytes: stage.receivedBytes + bytes.length,
    };
    if (next.receivedBytes > capture.expectedBytes) throw new Error('Oversized capture delivery.');
    await transaction(['captures', 'chunks'], 'readwrite', (tx) => {
      tx.objectStore('chunks').put({
        key: `${capture.id}/${index}`,
        captureId: capture.id,
        index,
        blob: new Blob([bytes]),
      });
      tx.objectStore('captures').put(next);
    });
    stage = next;
  }
  if (stage.receivedBytes !== capture.expectedBytes)
    throw new Error('Capture delivery is incomplete.');
  // IndexedDB returns Blob references, not full decoded PCM arrays. Assembly copies no sample buffers.
  const chunks = await transaction<{ index: number; blob: Blob }[]>(
    ['chunks'],
    'readonly',
    (tx, done) => {
      const r = tx.objectStore('chunks').index('captureId').getAll(capture.id);
      r.onsuccess = () => done(r.result);
    },
  );
  chunks.sort((a, b) => a.index - b.index);
  if (chunks.length !== capture.nextChunk || chunks.some((c, i) => c.index !== i))
    throw new Error('Missing captured audio chunk.');
  const wav = new Blob([wavHeader(capture), ...chunks.map((c) => c.blob)], { type: 'audio/wav' });
  const { collection: rawCollection, ...metadata } = capture.metadata,
    collection = parseCollection(rawCollection);
  if (!collection || !collection.trackIds.includes(String(metadata.trackId)))
    throw new Error('Captured song has no valid collection.');
  const rows = (rawCollection as { tracks?: unknown }).tracks;
  const validRows = Array.isArray(rows) && rows.length === collection.trackIds.length && rows.every((row, i) =>
    row?.trackId === collection.trackIds[i] && row.rowIndex === i &&
    typeof row.trackName === 'string' && row.trackName.length <= 500 &&
    typeof row.trackArtist === 'string' && row.trackArtist.length <= 500 &&
    typeof row.trackArtworkSrc === 'string' && row.trackArtworkSrc.length <= 4096);
  const id = `spotify-${metadata.trackId}`;
  await transaction(
    ['tracks', 'audio', 'collections', 'receipts', 'captures', 'chunks'],
    'readwrite',
    (tx) => {
      const tracks = tx.objectStore('tracks'),
        r = tracks.get(id);
      r.onsuccess = () => {
        if (!r.result) {
          tracks.add({
            id,
            title: String(metadata.trackName || 'Untitled'),
            artist: String(metadata.trackArtist || ''),
            createdAt: Date.now(),
            sampleRate: Number(metadata.audioSampleRate),
            frames: capture.expectedBytes / (Number(metadata.audioChannelCount) * 4),
            source: 'spotify',
            status: 'captured',
            bytes: wav.size,
            metadata,
          } satisfies LocalTrack);
          tx.objectStore('audio').put({
            key: `${id}/input.wav`,
            trackId: id,
            name: 'input.wav',
            blob: wav,
          });
        }
      };
      const store = tx.objectStore('collections'),
        existing = store.get(collection.path);
      existing.onsuccess = () => {
        store.put({ ...existing.result, ...collection,
          tracks: validRows ? rows.map(({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex }) => ({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex })) : existing.result?.tracks,
          startedAt: existing.result?.startedAt ?? Date.now(), savedAt: existing.result?.savedAt ?? Date.now() });
      };
      tx.objectStore('receipts').put({ id: capture.id, trackId: id });
      tx.objectStore('captures').delete(capture.id);
      for (const chunk of chunks) tx.objectStore('chunks').delete(`${capture.id}/${chunk.index}`);
    },
    { durability: 'strict' },
  );
  // No acknowledgment before the transaction above has completed successfully.
  await request('ack', { id: capture.id });
}
export async function drainDeliveries(request = spotifyRequest, wait = false) {
  if (embeddedSpotify) return;
  return navigator.locks.request('ktv420-delivery', { ifAvailable: !wait }, async (lock) => {
    if (!lock) return;
    const failures: unknown[] = [];
    // A new playlist made entirely of already saved songs still needs its membership.
    const collections = await request<(LibraryCollection & { handoffId: string })[]>('collections').catch(() => []);
    for (const collection of collections) {
      try {
        await rememberCollection(collection, collection.tracks);
        await request('ack-collection', { path: collection.path, requestId: collection.handoffId });
      } catch (error) { failures.push(error); }
    }
    const capabilities = await request<{ stagedAudio?: boolean; extensionQueue?: boolean }>('hello');
    if (capabilities.stagedAudio) {
      // A website separation must finish before a prepared result can replace its input.
      await navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
        if (!lock) return;
        if (capabilities.extensionQueue) {
          try { await returnUnfinishedOriginals(request); } catch (error) { failures.push(error); }
        }
        for (const prepared of await request<PreparedAudio[]>('prepared')) {
          try { await receivePrepared(prepared, request); } catch (error) { failures.push(error); }
        }
      });
    }
    if (failures.length) throw new Error(`${failures.length} import${failures.length === 1 ? '' : 's'} pending: ${failures[0] instanceof Error ? failures[0].message : String(failures[0])}`);
  });
}

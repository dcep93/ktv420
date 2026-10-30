import { requireStorage } from '../storageBudget';
import { transaction, type LocalTrack, type StoredAudio } from '../library';
import { parseCollection } from '../savedCollections';
import { CHUNK_BYTES, decodeChunk } from '../../../shared/captureFormat';
import { parsePrepared, validatePreparedFile, type PreparedAudio } from '../../../shared/preparedAudio';
import { spotifyRequest } from './client';

type Stage = { id: string; manifest: string; offsets: Record<string, number> };
type Part = { key: string; captureId: string; name: string; index: number; blob: Blob };
async function discardStage(id: string) {
  await transaction(['captures', 'chunks'], 'readwrite', tx => {
    tx.objectStore('captures').delete(id);
    const r = tx.objectStore('chunks').index('captureId').openCursor(id);
    r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } };
  });
}
/** Source acknowledgment follows the durable files + membership + receipt commit. */
export async function receivePrepared(value: PreparedAudio, request = spotifyRequest) {
  const p = parsePrepared(value), id = `prepared/${p.id}`, trackId = `spotify-${p.capture.metadata.trackId}`;
  const received = await transaction<'discarded' | 'received' | null>(['receipts', 'tracks', 'audio', 'settings'], 'readonly', (tx, done) => {
    const receipt = tx.objectStore('receipts').get(id), track = tx.objectStore('tracks').get(trackId), audio = tx.objectStore('audio').index('trackId').getAll(trackId), deleted = tx.objectStore('settings').get(`deleted/${trackId}`);
    deleted.onsuccess = () => done(deleted.result && p.capture.createdAt <= deleted.result ? 'discarded' :
      receipt.result && track.result?.status === 'ready' && p.files.every(f => audio.result.some((a: StoredAudio) => a.name === (f.name === 'artwork' ? 'artwork' : `${f.name}.mp3`) && a.blob.size > 0)) ? 'received' : null);
  });
  if (received) { await discardStage(id); await request('ack-prepared', { id: p.id, discarded: received === 'discarded' }); return; }
  const collection = parseCollection(p.capture.metadata.collection);
  if (!collection || !collection.trackIds.includes(String(p.capture.metadata.trackId))) throw new Error('Prepared song has no playlist metadata.');
  const prior = await transaction<Stage | undefined>(['captures'], 'readonly', (tx, done) => { const r = tx.objectStore('captures').get(id); r.onsuccess = () => done(r.result); });
  if (prior && prior.manifest !== JSON.stringify(p)) await discardStage(id);
  let stage = await transaction<Stage>(['captures'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('captures'), r = store.get(id);
    r.onsuccess = () => {
      const next = r.result || { id, manifest: JSON.stringify(p), offsets: {} };
      if (next.manifest !== JSON.stringify(p)) { tx.abort(); return; }
      store.put(next); done(next);
    };
  });
  await requireStorage(p.files.reduce((sum, f) => sum + f.bytes, 0));
  const blobs = new Map<string, Blob>();
  for (const f of p.files) {
    for (let index = stage.offsets[f.name] || 0; index < Math.ceil(f.bytes / CHUNK_BYTES); index++) {
      const bytes = decodeChunk(await request<string>('prepared-chunk', { id: p.id, name: f.name, index }));
      if (bytes.length !== Math.min(CHUNK_BYTES, f.bytes - index * CHUNK_BYTES)) throw new Error('Incomplete prepared audio chunk.');
      const next = { ...stage, offsets: { ...stage.offsets, [f.name]: index + 1 } };
      await transaction(['captures', 'chunks'], 'readwrite', tx => {
        tx.objectStore('chunks').put({ key: `${id}/${f.name}/${index}`, captureId: id, name: f.name, index, blob: new Blob([bytes]) });
        tx.objectStore('captures').put(next);
      });
      stage = next;
    }
    const parts = await transaction<Part[]>(['chunks'], 'readonly', (tx, done) => {
      const r = tx.objectStore('chunks').index('captureId').getAll(id);
      r.onsuccess = () => done((r.result as Part[]).filter(c => c.name === f.name).sort((a, b) => a.index - b.index));
    });
    const blob = new Blob(parts.map(c => c.blob), { type: f.type });
    try {
      if (parts.some((c, i) => c.index !== i)) throw new Error('Missing prepared audio chunk.');
      await validatePreparedFile(p, f, blob);
    } catch (error) { await discardStage(id); throw error; }
    blobs.set(f.name, blob);
  }
  const { collection: rawCollection, ...metadata } = p.capture.metadata;
  const rows = (rawCollection as { tracks?: unknown }).tracks;
  const validRows = Array.isArray(rows) && rows.length === collection.trackIds.length && rows.every((r, i) => r?.trackId === collection.trackIds[i] && r.rowIndex === i && typeof r.trackName === 'string' && typeof r.trackArtist === 'string' && typeof r.trackArtworkSrc === 'string');
  let discarded = false;
  await transaction(['tracks', 'audio', 'collections', 'receipts', 'captures', 'chunks', 'settings'], 'readwrite', tx => {
    const tracks = tx.objectStore('tracks'), existing = tracks.get(trackId), deleted = tx.objectStore('settings').get(`deleted/${trackId}`);
    deleted.onsuccess = () => {
      if (deleted.result && p.capture.createdAt <= deleted.result) { discarded = true; return; }
      const audio = tx.objectStore('audio'), files = audio.index('trackId').getAll(trackId);
      files.onsuccess = () => {
        const saved = files.result as StoredAudio[];
        const alreadyReady = existing.result?.status === 'ready' && Number(existing.result?.metadata?.captureCreatedAt || 0) >= p.capture.createdAt && p.files.filter(f => f.name !== 'artwork').every(f => saved.some(s => s.name === `${f.name}.mp3` && s.blob.size > 0));
        if (!alreadyReady) {
          for (const file of saved) audio.delete(file.key);
          for (const [name, blob] of blobs) {
            const fileName = name === 'artwork' ? name : `${name}.mp3`;
            audio.put({ key: `${trackId}/${fileName}`, trackId, name: fileName, blob });
          }
          tracks.put({ id: trackId, title: String(metadata.trackName || 'Untitled'), artist: String(metadata.trackArtist || ''),
            createdAt: existing.result?.createdAt ?? p.capture.createdAt, source: 'spotify', status: 'ready',
            sampleRate: Number(metadata.audioSampleRate), frames: p.capture.expectedBytes / (Number(metadata.audioChannelCount) * 4),
            bytes: p.files.reduce((sum, f) => sum + f.bytes, 0), playbackGain: p.encoding.gain,
            metadata: { ...metadata, captureCreatedAt: p.capture.createdAt, separation: p.metadata, encoding: p.encoding },
          } satisfies LocalTrack);
        } else if (blobs.has('artwork') && !saved.some(s => s.name === 'artwork')) {
          const blob = blobs.get('artwork')!; audio.put({ key: `${trackId}/artwork`, trackId, name: 'artwork', blob });
          tracks.put({ ...existing.result, bytes: existing.result.bytes + blob.size });
        }
      };
    };
    const collections = tx.objectStore('collections'), c = collections.get(collection.path);
    const removed = tx.objectStore('settings').get(`deleted-collection/${collection.path}`);
    removed.onsuccess = () => {
      if (removed.result && p.capture.createdAt <= removed.result) return;
      if ((c.result?.observedAt || 0) > (collection.observedAt || p.capture.createdAt)) return;
      collections.put({ ...c.result, ...collection, observedAt: collection.observedAt || p.capture.createdAt,
      tracks: validRows ? rows : c.result?.tracks, startedAt: c.result?.startedAt ?? Date.now(), savedAt: c.result?.savedAt ?? Date.now() });
    };
    tx.objectStore('receipts').put({ id, trackId });
    for (const key of [id, p.id]) {
      tx.objectStore('captures').delete(key);
      const cursor = tx.objectStore('chunks').index('captureId').openCursor(key);
      cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
    }
  }, { durability: 'strict' });
  await request('ack-prepared', { id: p.id, discarded });
}

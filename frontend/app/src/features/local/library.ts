import { MP3_NAMES, type Mp3Files, type Mp3Encoding } from './audio/mp3Types';
import type { PlaybackFile, PlaybackRecord } from '../stems/player/types';

export const LIBRARY_DB = 'ktv420-library';
export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;
export type TrackStatus = 'captured' | 'processing' | 'ready' | 'error';
export type LocalTrack = {
  id: string; title: string; artist: string; createdAt: number;
  sampleRate: number; frames: number; status: TrackStatus; bytes: number;
  error?: string; source: 'file' | 'spotify'; metadata?: Record<string, unknown>; playbackGain?: number;
};
export type StoredAudio = { key: string; trackId: string; name: string; blob: Blob };
export type CaptureSession = {
  id: string; tabId: number; expectedBytes: number; receivedBytes: number; nextChunk: number;
  metadata: Record<string, unknown>; createdAt: number;
};

export function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LIBRARY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('tracks', { keyPath: 'id' });
      db.createObjectStore('audio', { keyPath: 'key' }).createIndex('trackId', 'trackId');
      db.createObjectStore('captures', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: 'key' }).createIndex('captureId', 'captureId');
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other ktv420 tabs to update local storage.'));
  });
}

// Resolve on commit, never merely on request success. Transaction aborts must reach the UI.
export async function transaction<T>(stores: string[], mode: IDBTransactionMode,
  run: (tx: IDBTransaction, setResult: (result: T) => void) => void): Promise<T> {
  const db = await openLibrary();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local storage operation was interrupted.')); };
    tx.onerror = () => { /* onabort reports the terminal error */ };
    try { run(tx, (value) => { result = value; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}

export function listTracks(): Promise<LocalTrack[]> {
  return transaction(['tracks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('tracks').getAll();
    request.onsuccess = () => done((request.result as LocalTrack[]).sort((a, b) => b.createdAt - a.createdAt));
  });
}
export function getTrack(id: string): Promise<LocalTrack | undefined> {
  return transaction(['tracks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('tracks').get(id);
    request.onsuccess = () => done(request.result);
  });
}
export function getInput(id: string): Promise<Blob> {
  return transaction(['audio'], 'readonly', (tx, done) => {
    const request = tx.objectStore('audio').get(`${id}/input.wav`);
    request.onsuccess = () => { if (!request.result) tx.abort(); else done(request.result.blob); };
  });
}
export function getPlaybackRecord(id: string): Promise<PlaybackRecord> {
  return transaction(['audio', 'tracks'], 'readonly', (tx, done) => {
    const track = tx.objectStore('tracks').get(id);
    const request = tx.objectStore('audio').index('trackId').getAll(id);
    request.onsuccess = () => done({ md5: id, playbackGain: track.result?.playbackGain, artwork: (request.result as StoredAudio[]).find(file => file.name === 'artwork')?.blob, files: (request.result as StoredAudio[]).filter(file => file.name !== 'artwork').map((file): PlaybackFile => ({
      name: file.name, path: `${id}/${(file.name === 'input.wav' || file.name === 'input.mp3') ? 'input' : 'output'}/${file.name}`, blob: file.blob,
    })) });
  });
}
export function saveInput(track: LocalTrack, wav: Blob, source?: Blob): Promise<void> {
  return transaction(['tracks', 'audio'], 'readwrite', (tx) => {
    const existing = tx.objectStore('tracks').get(track.id);
    existing.onsuccess = () => {
      // Recapture is idempotent. Replacing an input while a worker reads it would corrupt provenance.
      if (existing.result) return;
      tx.objectStore('tracks').add({ ...track, status: 'captured', bytes: wav.size + (source?.size || 0) });
      tx.objectStore('audio').add({ key: `${track.id}/input.wav`, trackId: track.id, name: 'input.wav', blob: wav });
      if (source) tx.objectStore('audio').add({ key: `${track.id}/source`, trackId: track.id, name: 'source', blob: source });
    };
  });
}
export function setTrackStatus(id: string, status: TrackStatus, error?: string): Promise<void> {
  return transaction(['tracks'], 'readwrite', (tx) => {
    const store = tx.objectStore('tracks'); const request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, status, error }); };
  });
}
/** Called only after broker validation; the transaction retains raw audio on every failure. */
export function saveMp3(id: string, files: Mp3Files, metadata: Record<string, unknown>, encoding: Mp3Encoding): Promise<void> {
  return transaction(['tracks', 'audio'], 'readwrite', tx => {
    const store = tx.objectStore('tracks'), audio = tx.objectStore('audio');
    const request = store.get(id);
    request.onsuccess = () => {
      const track = request.result as LocalTrack | undefined;
      if (!track || !Number.isFinite(encoding.gain) || encoding.gain <= 0 || encoding.gain > 1) { tx.abort(); return; }
      const existing = audio.index('trackId').getAll(id);
      existing.onsuccess = () => {
        const originals = existing.result as StoredAudio[];
        if (!originals.some(file => file.name === 'input.wav')) { tx.abort(); return; }
        let bytes = 0;
        for (const name of MP3_NAMES) {
          if (!(files[name] instanceof Blob) || files[name].size < 417) { tx.abort(); return; }
          bytes += files[name].size;
        }
        for (const file of originals) audio.delete(file.key);
        for (const name of MP3_NAMES) audio.put({ key: `${id}/${name}.mp3`, trackId: id, name: `${name}.mp3`, blob: files[name] });
        store.put({ ...track, status: 'ready', error: undefined, bytes, playbackGain: encoding.gain,
          metadata: { ...track.metadata, separation: metadata, encoding } });
      };
    };
  });
}
export function deleteTrack(id: string): Promise<void> { return deleteTracks([id]); }

export function deleteTracks(ids: string[]): Promise<void> {
  return transaction(['tracks', 'audio'], 'readwrite', (tx) => {
    for (const id of new Set(ids)) {
      tx.objectStore('tracks').delete(id);
      const request = tx.objectStore('audio').index('trackId').openKeyCursor(IDBKeyRange.only(id));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { tx.objectStore('audio').delete(cursor.primaryKey); cursor.continue(); } };
    }
  });
}

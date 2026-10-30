import { parseCollection } from '../features/local/savedCollections';
import type { PlaylistSnapshot } from '../features/local/spotify/discover';
import { parseLibrarySummary, type LibrarySummary } from '../shared/librarySummary';
import { decodeChunk, validateCapture, type QueuedCapture } from '../shared/captureFormat';
/** Temporary audio delivery plus website status/playlist metadata. No playback library. */
export const QUEUE_DB = 'ktv420-capture-delivery-v1';
export async function queueTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(QUEUE_DB, 3);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('collections')) r.result.createObjectStore('collections', { keyPath: 'path' });
      if (!r.result.objectStoreNames.contains('library')) r.result.createObjectStore('library');
      if (r.result.objectStoreNames.contains('captures')) return;
      r.result.createObjectStore('captures', { keyPath: 'id' });
      r.result
        .createObjectStore('chunks', { keyPath: 'key' })
        .createIndex('captureId', 'captureId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Capture delivery transaction failed.'));
    };
    tx.onerror = () => {};
    try {
      run(tx, (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}
export async function beginCapture(
  tabId: number,
  metadata: Record<string, unknown>,
  bytes: number,
) {
  validateCapture(metadata, bytes);
  const id = crypto.randomUUID();
  await queueTransaction(['captures', 'chunks'], 'readwrite', (tx) => {
    const cursor = tx.objectStore('captures').openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const old = c.value as QueuedCapture;
      // Only unfinished staging from this sender may be replaced. Completed recordings have no expiry.
      if (old.id !== id && old.tabId === tabId && !old.complete) {
        c.delete();
        const chunks = tx.objectStore('chunks').index('captureId').openCursor(old.id);
        chunks.onsuccess = () => {
          const p = chunks.result;
          if (p) {
            p.delete();
            p.continue();
          }
        };
      }
      c.continue();
    };
    tx.objectStore('captures').add({
      id,
      tabId,
      metadata,
      expectedBytes: bytes,
      receivedBytes: 0,
      nextChunk: 0,
      createdAt: Date.now(),
      complete: false,
    } satisfies QueuedCapture);
  });
  return id;
}
export async function appendCapture(tabId: number, id: string, index: number, base64: string) {
  const bytes = decodeChunk(base64);
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid chunk index.');
  return queueTransaction(['captures', 'chunks'], 'readwrite', (tx) => {
    const store = tx.objectStore('captures'),
      r = store.get(id);
    r.onsuccess = () => {
      const c = r.result as QueuedCapture | undefined;
      if (!c || c.tabId !== tabId || c.complete || index > c.nextChunk) {
        tx.abort();
        return;
      }
      if (index < c.nextChunk) {
        const prior = tx.objectStore('chunks').get(`${id}/${index}`);
        prior.onsuccess = () => {
          const old = prior.result?.bytes;
          if (!old || old.length !== bytes.length || bytes.some((v, i) => v !== old[i])) tx.abort();
        };
        return;
      }
      if (c.receivedBytes + bytes.length > c.expectedBytes) {
        tx.abort();
        return;
      }
      tx.objectStore('chunks').add({ key: `${id}/${index}`, captureId: id, index, bytes });
      store.put({ ...c, nextChunk: index + 1, receivedBytes: c.receivedBytes + bytes.length });
    };
  });
}
export function finishCapture(tabId: number, id: string) {
  return queueTransaction(['captures'], 'readwrite', (tx) => {
    const store = tx.objectStore('captures'),
      r = store.get(id);
    r.onsuccess = () => {
      const c = r.result as QueuedCapture | undefined;
      if (!c || c.tabId !== tabId || c.receivedBytes !== c.expectedBytes) {
        tx.abort();
        return;
      }
      store.put({ ...c, complete: true });
    };
  });
}
export function pendingCaptures(): Promise<QueuedCapture[]> {
  return queueTransaction(['captures'], 'readonly', (tx, done) => {
    const r = tx.objectStore('captures').getAll();
    r.onsuccess = () => done(r.result.filter((c: QueuedCapture) => c.complete));
  });
}
export function readChunk(id: string, index: number): Promise<string> {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid chunk index.');
  return queueTransaction(['captures', 'chunks'], 'readonly', (tx, done) => {
    const r = tx.objectStore('captures').get(id);
    r.onsuccess = () => {
      if (!r.result?.complete || index >= r.result.nextChunk) {
        tx.abort();
        return;
      }
      const chunk = tx.objectStore('chunks').get(`${id}/${index}`);
      chunk.onsuccess = () => {
        if (!chunk.result) {
          tx.abort();
          return;
        }
        let binary = '';
        for (const value of chunk.result.bytes) binary += String.fromCharCode(value);
        done(btoa(binary));
      };
    };
  });
}
export function acknowledgeCapture(id: string) {
  return queueTransaction(['captures', 'chunks', 'library'], 'readwrite', (tx) => {
    const r = tx.objectStore('captures').get(id);
    r.onsuccess = () => {
      if (!r.result) return;
      if (!r.result.complete) {
        tx.abort();
        return;
      }
      const trackId = `spotify-${r.result.metadata.trackId}`;
      const library = tx.objectStore('library'), previous = library.get(trackId);
      previous.onsuccess = () => { if (!previous.result) library.put({ id: trackId, status: 'captured' }, trackId); };
      tx.objectStore('captures').delete(id);
      const cursor = tx.objectStore('chunks').index('captureId').openCursor(id);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
    };
  });
}

export function publishLibrarySummary(value: unknown) {
  const tracks = parseLibrarySummary(value);
  return queueTransaction(['library'], 'readwrite', tx => {
    const store = tx.objectStore('library');
    store.clear();
    for (const track of tracks) store.put(track, track.id);
  });
}
export async function readLibrarySummary(): Promise<LibrarySummary[]> {
  const saved = await queueTransaction<LibrarySummary[]>(['library'], 'readonly', (tx, done) => {
    const r = tx.objectStore('library').getAll(); r.onsuccess = () => done(r.result);
  });
  const tracks = new Map(saved.map(track => [track.id, track]));
  for (const capture of await pendingCaptures()) {
    const id = `spotify-${capture.metadata.trackId}`;
    if (!tracks.has(id)) tracks.set(id, { id, status: 'captured' });
  }
  return [...tracks.values()];
}

export function rememberPlayerCollection(snapshot: PlaylistSnapshot) {
  const collection = parseCollection(snapshot?.collection), rows = snapshot?.tracks;
  if (!collection || !snapshot.complete || !Array.isArray(rows) || rows.length !== collection.trackIds.length ||
    !rows.every((row, i) => row?.trackId === collection.trackIds[i] && row.rowIndex === i &&
      typeof row.trackName === 'string' && row.trackName.length <= 500 && typeof row.trackArtist === 'string' && row.trackArtist.length <= 500 &&
      typeof row.trackArtworkSrc === 'string' && row.trackArtworkSrc.length <= 4096)) throw new Error('Spotify playlist is not ready.');
  return queueTransaction(['collections'], 'readwrite', tx => {
    tx.objectStore('collections').put({ ...collection, handoffId: crypto.randomUUID(), tracks: rows.map(({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex }) => ({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex })) });
  });
}
export function playerCollections() {
  return queueTransaction(['collections'], 'readonly', (tx, done) => {
    const r = tx.objectStore('collections').getAll(); r.onsuccess = () => done(r.result);
  });
}

export function acknowledgePlayerCollection(path: string, handoffId: string) {
  return queueTransaction(['collections'], 'readwrite', tx => {
    const store = tx.objectStore('collections'), r = store.get(path);
    r.onsuccess = () => { if (r.result?.handoffId === handoffId) store.delete(path); };
  });
}

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_DB, pendingCaptures, readChunk } from './queue';
import { preparedCaptures } from './staging';
test('schema 3 upgrade preserves completed raw captures and their chunks', async () => {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open(QUEUE_DB, 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('captures', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: 'key' }).createIndex('captureId', 'captureId');
      db.createObjectStore('collections', { keyPath: 'path' }); db.createObjectStore('library');
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction(['captures', 'chunks'], 'readwrite');
      tx.objectStore('captures').put({ id, tabId: 1, complete: true, nextChunk: 1, expectedBytes: 4, receivedBytes: 4, metadata: { trackId: 'old' }, createdAt: 1 });
      tx.objectStore('chunks').put({ key: `${id}/0`, captureId: id, index: 0, bytes: new Uint8Array([0, 1, 2, 3]) });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  assert.equal((await pendingCaptures())[0].id, id);
  assert.equal(await readChunk(id, 0), 'AAECAw==');
  assert.deepEqual(await preparedCaptures(), []);
});

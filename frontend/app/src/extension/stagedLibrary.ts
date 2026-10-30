import { queueTransaction } from './queue';
import { CHUNK_BYTES, type QueuedCapture } from '../shared/captureFormat';
import { AUDIO_NAMES, type PreparedAudio } from '../shared/preparedAudio';
import type { StagedAudio } from '../shared/stagedLibrary';

const stores = ['captures', 'prepared', 'claims', 'uploads'];
/** Read manifests and counters only, never load the audio blobs to render settings. */
export function listStagedAudio(): Promise<StagedAudio[]> {
  return queueTransaction(stores, 'readonly', (tx, done) => {
    const captures = tx.objectStore('captures').getAll(), prepared = tx.objectStore('prepared').getAll(),
      claims = tx.objectStore('claims').getAll(), uploads = tx.objectStore('uploads').getAll();
    uploads.onsuccess = () => {
      const busy = new Set(claims.result.filter(c => c.expires > Date.now()).map(c => c.id));
      const row = (c: QueuedCapture, bytes: number, ready: boolean): StagedAudio => ({
        id: c.id, title: String(c.metadata.trackName || 'Untitled recording'), bytes, ready, busy: busy.has(c.id),
      });
      done([
        ...captures.result.filter((c: QueuedCapture) => c.complete).map((c: QueuedCapture) => {
          const upload = uploads.result.find(u => u.id === c.id);
          const output = (upload?.manifest.files || []).reduce((sum: number, file: { name: string; bytes: number }) =>
            sum + Math.min(file.bytes, (upload.offsets[file.name] || 0) * CHUNK_BYTES), 0);
          return row(c, c.receivedBytes + output, false);
        }),
        ...prepared.result.map((p: PreparedAudio) => row(p.capture, p.files.reduce((sum, f) => sum + f.bytes, 0), true)),
      ]);
    };
  });
}
/** A confirmation names a fixed snapshot; new recordings are never swept into it. */
export async function deleteStagedAudio(ids: string[]): Promise<void> {
  const deleted = await queueTransaction<boolean>([...stores, 'chunks', 'preparedFiles'], 'readwrite', (tx, done) => {
    const captures = tx.objectStore('captures').getAll(), claims = tx.objectStore('claims').getAll();
    claims.onsuccess = () => {
      const targets = new Set(ids);
      if (captures.result.some((c: QueuedCapture) => targets.has(c.id) && !c.complete) ||
          claims.result.some(c => targets.has(c.id) && c.expires > Date.now())) { done(false); return; }
      for (const id of targets) {
        for (const store of stores) tx.objectStore(store).delete(id);
        for (const name of AUDIO_NAMES) tx.objectStore('preparedFiles').delete(`${id}/${name}`);
        for (const key of [id, `output/${id}`]) {
          const cursor = tx.objectStore('chunks').index('captureId').openKeyCursor(key);
          cursor.onsuccess = () => { const c = cursor.result; if (c) { tx.objectStore('chunks').delete(c.primaryKey); c.continue(); } };
        }
      }
      done(true);
    };
  }, { durability: 'strict' });
  if (!deleted) throw new Error('Audio is being processed or transferred. Pause separation or wait for the transfer to finish.');
}

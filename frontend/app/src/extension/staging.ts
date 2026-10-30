import { queueTransaction, pendingCaptures } from './queue';
import { CHUNK_BYTES, decodeChunk, type QueuedCapture } from '../shared/captureFormat';
import { parsePrepared, validatePreparedFile, encodeBlobChunk, sha256, type PreparedAudio, type AudioName } from '../shared/preparedAudio';
export const LEASE_MS = 120000;
type Claim = { id: string; token: string; owner: number | 'website'; expires: number; progress?: { fraction: number; message: string } };
export async function claimCapture(id: string, owner: number | 'website'): Promise<string | null> {
  return queueTransaction(['captures', 'claims'], 'readwrite', (tx, done) => {
    const r = tx.objectStore('captures').get(id);
    r.onsuccess = () => {
      const capture = r.result as QueuedCapture | undefined;
      if (!capture?.complete || (owner !== 'website' && capture.tabId !== owner)) { done(null); return; }
      const store = tx.objectStore('claims'), prior = store.get(id);
      prior.onsuccess = () => {
        if (prior.result?.expires > Date.now()) { done(null); return; }
        const token = crypto.randomUUID();
        store.put({ id, token, owner, expires: Date.now() + LEASE_MS } satisfies Claim); done(token);
      };
    };
  });
}
export function touchClaim(id: string, token: string, owner: number | 'website', progress?: Claim['progress']) {
  return queueTransaction(['claims'], 'readwrite', (tx) => {
    const store = tx.objectStore('claims'), r = store.get(id);
    r.onsuccess = () => {
      const c = r.result as Claim | undefined;
      if (!c || c.token !== token || c.owner !== owner || c.expires <= Date.now()) { tx.abort(); return; }
      store.put({ ...c, expires: Date.now() + LEASE_MS, progress: progress || c.progress });
    };
  });
}
export function releaseClaim(id: string, token: string, owner: number | 'website') {
  return queueTransaction(['claims', 'uploads', 'chunks'], 'readwrite', tx => {
    const r = tx.objectStore('claims').get(id);
    r.onsuccess = () => {
      if (r.result?.token !== token || r.result.owner !== owner) return;
      tx.objectStore('claims').delete(id); tx.objectStore('uploads').delete(id);
      const cursor = tx.objectStore('chunks').index('captureId').openCursor(`output/${id}`);
      cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
    };
  });
}
export async function stagedSummary() {
  const [raw, ready, claims] = await Promise.all([pendingCaptures(), preparedCaptures(), queueTransaction<Claim[]>(['claims'], 'readonly', (tx, done) => {
    const r = tx.objectStore('claims').getAll(); r.onsuccess = () => done(r.result);
  })]);
  return [...raw.map(c => {
    const claim = claims.find(l => l.id === c.id && l.owner !== 'website' && l.expires > Date.now());
    return { id: `spotify-${c.metadata.trackId}`, status: claim ? 'processing' as const : 'captured' as const, progress: claim?.progress };
  }), ...ready.map(p => ({ id: `spotify-${p.capture.metadata.trackId}`, status: 'ready' as const }))];
}
export function preparedCaptures(): Promise<PreparedAudio[]> {
  return queueTransaction(['prepared'], 'readonly', (tx, done) => { const r = tx.objectStore('prepared').getAll(); r.onsuccess = () => done(r.result); });
}
export async function beginPrepared(value: unknown, token: string, owner: number) {
  const p = parsePrepared(value);
  await touchClaim(p.id, token, owner);
  // Never accept source metadata supplied by the hosted worker over the verified capture.
  const source = (await pendingCaptures()).find(c => c.id === p.id);
  if (!source || JSON.stringify(source) !== JSON.stringify(p.capture)) throw new Error('Prepared source changed.');
  return queueTransaction(['uploads', 'chunks', 'claims'], 'readwrite', tx => {
    const claim = tx.objectStore('claims').get(p.id), previous = tx.objectStore('uploads').get(p.id);
    previous.onsuccess = () => {
      if (claim.result?.token !== token || claim.result.owner !== owner || claim.result.expires <= Date.now()) { tx.abort(); return; }
      if (previous.result?.token === token) {
        if (JSON.stringify(previous.result.manifest) !== JSON.stringify(p)) tx.abort();
        return;
      }
      tx.objectStore('uploads').put({ id: p.id, token, manifest: p, offsets: {} });
      const cursor = tx.objectStore('chunks').index('captureId').openCursor(`output/${p.id}`);
      cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
    };
  });
}
export async function appendPrepared(id: string, token: string, owner: number, name: AudioName, index: number, base64: string) {
  await touchClaim(id, token, owner);
  const bytes = decodeChunk(base64), blob = new Blob([bytes]), hash = await sha256(blob);
  return queueTransaction(['uploads', 'chunks', 'claims'], 'readwrite', tx => {
    const claim = tx.objectStore('claims').get(id);
    const store = tx.objectStore('uploads'), r = store.get(id);
    r.onsuccess = () => {
      const u = r.result, file = u?.manifest.files.find((f: { name: string }) => f.name === name);
      if (claim.result?.token !== token || claim.result.owner !== owner || claim.result.expires <= Date.now() || !u || u.token !== token || !file || index > (u.offsets[name] || 0) || bytes.length !== Math.min(CHUNK_BYTES, file.bytes - index * CHUNK_BYTES)) { tx.abort(); return; }
      if (index < (u.offsets[name] || 0)) {
        const previous = tx.objectStore('chunks').get(`output/${id}/${name}/${index}`);
        previous.onsuccess = () => { if (previous.result?.hash !== hash || previous.result?.blob.size !== bytes.length) tx.abort(); };
        return;
      }
      tx.objectStore('chunks').put({ key: `output/${id}/${name}/${index}`, captureId: `output/${id}`, name, index, blob, hash });
      u.offsets[name] = index + 1; store.put(u);
    };
  });
}
export async function finishPrepared(id: string, token: string, owner: number) {
  const committed = (await preparedCaptures()).find(p => p.id === id);
  if (committed?.capture.tabId === owner) return;
  await touchClaim(id, token, owner);
  const [upload, chunks] = await queueTransaction<[{ token: string; manifest: PreparedAudio }, { name: AudioName; index: number; blob: Blob }[]]>(['uploads', 'chunks'], 'readonly', (tx, done) => {
    const u = tx.objectStore('uploads').get(id), c = tx.objectStore('chunks').index('captureId').getAll(`output/${id}`);
    c.onsuccess = () => done([u.result, c.result]);
  });
  if (!upload || upload.token !== token) throw new Error('Prepared upload is missing.');
  const p = parsePrepared(upload.manifest), files: { id: string; blob: Blob }[] = [];
  for (const f of p.files) {
    const parts = chunks.filter(c => c.name === f.name).sort((a, b) => a.index - b.index);
    if (parts.length !== Math.ceil(f.bytes / CHUNK_BYTES) || parts.some((c, i) => c.index !== i)) throw new Error('Prepared upload is incomplete.');
    const blob = new Blob(parts.map(c => c.blob), { type: f.type });
    await validatePreparedFile(p, f, blob);
    files.push({ id: `${id}/${f.name}`, blob });
  }
  return queueTransaction(['claims', 'captures', 'chunks', 'uploads', 'prepared', 'preparedFiles'], 'readwrite', tx => {
    const r = tx.objectStore('claims').get(id);
    r.onsuccess = () => {
      if (r.result?.token !== token || r.result.owner !== owner || r.result.expires <= Date.now()) { tx.abort(); return; }
      tx.objectStore('prepared').put(p);
      for (const file of files) tx.objectStore('preparedFiles').put(file);
      tx.objectStore('captures').delete(id); tx.objectStore('claims').delete(id); tx.objectStore('uploads').delete(id);
      for (const key of [id, `output/${id}`]) {
        const cursor = tx.objectStore('chunks').index('captureId').openCursor(key);
        cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
      }
    };
  }, { durability: 'strict' });
}
export async function preparedChunk(id: string, name: AudioName, index: number) {
  const blob = await queueTransaction<Blob>(['prepared', 'preparedFiles'], 'readonly', (tx, done) => {
    const p = tx.objectStore('prepared').get(id), f = tx.objectStore('preparedFiles').get(`${id}/${name}`);
    f.onsuccess = () => {
      if (!p.result || !f.result || index * CHUNK_BYTES >= f.result.blob.size) { tx.abort(); return; }
      done(f.result.blob);
    };
  });
  return encodeBlobChunk(blob, index);
}
export function acknowledgePrepared(id: string) {
  return queueTransaction(['prepared', 'preparedFiles', 'library'], 'readwrite', tx => {
    const r = tx.objectStore('prepared').get(id);
    r.onsuccess = () => {
      const p = r.result as PreparedAudio | undefined;
      if (!p) return;
      const trackId = `spotify-${p.capture.metadata.trackId}`;
      tx.objectStore('library').put({ id: trackId, status: 'ready' }, trackId);
      for (const f of p.files) tx.objectStore('preparedFiles').delete(`${id}/${f.name}`);
      tx.objectStore('prepared').delete(id);
    };
  });
}

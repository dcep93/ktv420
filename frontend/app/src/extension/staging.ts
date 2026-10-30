import { progressIdentity, type WorkerClaim } from './workerHealth';
import { requireStorage } from '../features/local/storageBudget';
import type { WorkerOwner } from './workQueue';
import { queueTransaction, pendingCaptures } from './queue';
import { CHUNK_BYTES, decodeChunk, type QueuedCapture } from '../shared/captureFormat';
import { parsePrepared, validatePreparedFile, encodeBlobChunk, sha256, type PreparedAudio, type AudioName } from '../shared/preparedAudio';
export const LEASE_MS = 120000;
type Claim = WorkerClaim;
export async function claimCapture(id: string, owner: number | 'website' | WorkerOwner): Promise<string | null> {
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
export function touchClaim(id: string, token: string, owner: number | 'website' | WorkerOwner, progress?: Claim['progress']) {
  return queueTransaction(['claims'], 'readwrite', (tx) => {
    const store = tx.objectStore('claims'), r = store.get(id);
    r.onsuccess = () => {
      const c = r.result as Claim | undefined;
      if (!c || c.token !== token || c.owner !== owner || c.expires <= Date.now()) { tx.abort(); return; }
      const now = Date.now(), changed = !!progress && progressIdentity(progress) !== progressIdentity(c.progress);
      store.put({ ...c, expires: now + LEASE_MS, startedAt: c.startedAt ?? now,
        progressUpdatedAt: changed ? now : c.progressUpdatedAt ?? now,
        slowestStepMs: changed && c.progressUpdatedAt !== undefined ? Math.max(c.slowestStepMs || 0, now - c.progressUpdatedAt) : c.slowestStepMs,
        progress: progress || c.progress });
    };
  });
}
export function releaseClaim(id: string, token: string, owner: number | 'website' | WorkerOwner) {
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
export function stagedSummary(includeLibrary = false) {
  return queueTransaction<import('../shared/librarySummary').LibrarySummary[]>(['captures', 'prepared', 'claims', 'library'], 'readonly', (tx, done) => {
    const library = tx.objectStore('library').getAll();
    const raw = tx.objectStore('captures').getAll(), ready = tx.objectStore('prepared').getAll(), claims = tx.objectStore('claims').getAll();
    claims.onsuccess = () => { const staged = [
      ...raw.result.filter((c: QueuedCapture) => c.complete).map((c: QueuedCapture) => {
        const claim = claims.result.find(l => l.id === c.id && l.owner !== 'website' && l.expires > Date.now());
        return { id: `spotify-${c.metadata.trackId}`, status: c.processingError && !c.retryAt ? 'error' as const : claim ? 'processing' as const : 'captured' as const,
          progress: claim?.progress, error: c.processingError, retryAt: c.retryAt };
      }), ...ready.result.map((p: PreparedAudio) => ({ id: `spotify-${p.capture.metadata.trackId}`, status: 'ready' as const })),
    ];
      if (!includeLibrary) { done(staged); return; }
      const merged = new Map(library.result.map(t => [t.id, t]));
      for (const t of staged) merged.set(t.id, { ...t, location: 'extension' });
      done([...merged.values()] as import('../shared/librarySummary').LibrarySummary[]);
    };
  });
}
export function preparedCaptures(): Promise<PreparedAudio[]> {
  return queueTransaction(['prepared'], 'readonly', (tx, done) => { const r = tx.objectStore('prepared').getAll(); r.onsuccess = () => done(r.result); });
}
export async function beginPrepared(value: unknown, token: string, owner: number | WorkerOwner) {
  const p = parsePrepared(value);
  await requireStorage(p.files.reduce((sum, f) => sum + f.bytes, 0));
  await touchClaim(p.id, token, owner);
  // Never accept source metadata supplied by the hosted worker over the verified capture.
  const source = (await pendingCaptures()).find(c => c.id === p.id);
  const identity = (capture: QueuedCapture) => ({ id: capture.id, tabId: capture.tabId, metadata: capture.metadata, expectedBytes: capture.expectedBytes, receivedBytes: capture.receivedBytes, nextChunk: capture.nextChunk, createdAt: capture.createdAt, complete: capture.complete });
  if (!source || JSON.stringify(identity(source)) !== JSON.stringify(identity(p.capture))) throw new Error('Prepared source changed.');
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
export async function appendPrepared(id: string, token: string, owner: number | WorkerOwner, name: AudioName, index: number, base64: string) {
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
export async function finishPrepared(id: string, token: string, owner: number | WorkerOwner) {
  const committed = (await preparedCaptures()).find(p => p.id === id);
  if (committed) return;
  await touchClaim(id, token, owner);
  const [upload, chunks] = await queueTransaction<[{ token: string; manifest: PreparedAudio }, { name: AudioName; index: number; blob: Blob }[]]>(['uploads', 'chunks'], 'readonly', (tx, done) => {
    const u = tx.objectStore('uploads').get(id), c = tx.objectStore('chunks').index('captureId').getAll(`output/${id}`);
    c.onsuccess = () => done([u.result, c.result]);
  });
  if (!upload || upload.token !== token) throw new Error('Prepared upload is missing.');
  const renew = setInterval(() => { void touchClaim(id, token, owner).catch(() => {}); }, 10000);
  const deadline = Date.now() + 240000;
  try {
  const p = parsePrepared(upload.manifest), files: { id: string; blob: Blob }[] = [];
  for (const f of p.files) {
    const parts = chunks.filter(c => c.name === f.name).sort((a, b) => a.index - b.index);
    if (parts.length !== Math.ceil(f.bytes / CHUNK_BYTES) || parts.some((c, i) => c.index !== i)) throw new Error('Prepared upload is incomplete.');
    const blob = new Blob(parts.map(c => c.blob), { type: f.type });
    await validatePreparedFile(p, f, blob);
    if (Date.now() > deadline) throw new DOMException('Saved audio verification took too long. The recording is safe.', 'TimeoutError');
    files.push({ id: `${id}/${f.name}`, blob });
  }
  return await queueTransaction(['claims', 'captures', 'chunks', 'uploads', 'prepared', 'preparedFiles'], 'readwrite', tx => {
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
  } finally { clearInterval(renew); }
}
export async function preparedChunk(id: string, name: AudioName, index: number) {
  const blob = await queueTransaction<Blob>(['prepared', 'preparedFiles', 'claims'], 'readwrite', (tx, done) => {
    const p = tx.objectStore('prepared').get(id), f = tx.objectStore('preparedFiles').get(`${id}/${name}`);
    f.onsuccess = () => {
      if (!p.result || !f.result || index * CHUNK_BYTES >= f.result.blob.size) { tx.abort(); return; }
      tx.objectStore('claims').put({ id, token: crypto.randomUUID(), owner: 'website', expires: Date.now() + LEASE_MS } satisfies Claim);
      done(f.result.blob);
    };
  });
  return encodeBlobChunk(blob, index);
}
export function acknowledgePrepared(id: string, discarded = false) {
  return queueTransaction(['prepared', 'preparedFiles', 'library', 'claims'], 'readwrite', tx => {
    const r = tx.objectStore('prepared').get(id);
    r.onsuccess = () => {
      const p = r.result as PreparedAudio | undefined;
      if (!p) return;
      const trackId = `spotify-${p.capture.metadata.trackId}`;
      if (discarded) tx.objectStore('library').delete(trackId);
      else tx.objectStore('library').put({ id: trackId, status: 'ready' }, trackId);
      for (const f of p.files) tx.objectStore('preparedFiles').delete(`${id}/${f.name}`);
      tx.objectStore('prepared').delete(id);
      tx.objectStore('claims').delete(id);
    };
  });
}

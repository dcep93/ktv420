import { queueTransaction } from './queue';

export type WorkerClaim = {
  id: string; token: string; owner: string | number; expires: number;
  startedAt?: number; progressUpdatedAt?: number; slowestStepMs?: number;
  progress?: { fraction: number; message: string };
};
// Ignore the observer's elapsed-time suffix: a heartbeat is not model progress.
export const progressIdentity = (progress: WorkerClaim['progress']) => progress
  ? `${progress.fraction}/${progress.message.replace(/ · no new progress for \d+s$/, '')}` : '';
export function stalledClaim(claim: WorkerClaim, now = Date.now()) {
  if (claim.owner !== 'worker:background') return false;
  if (claim.expires <= now) return true;
  const changed = claim.progressUpdatedAt ?? claim.startedAt;
  if (changed === undefined) return false; // Old workers have no reliable progress clock.
  const minimum = /CPU|WASM/i.test(claim.progress?.message || '') ? 180000 : 90000;
  return now - changed > Math.max(minimum, (claim.slowestStepMs || 0) * 4);
}
/** Atomically invalidate stale owners before restarting; keep the verified original. */
export function recoverStalledWork(now = Date.now()) {
  return queueTransaction<boolean>(['claims', 'captures', 'uploads', 'chunks'], 'readwrite', (tx, done) => {
    let recovered = false;
    const r = tx.objectStore('claims').openCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) { done(recovered); return; }
      const claim = cursor.value as WorkerClaim;
      if (stalledClaim(claim, now)) {
        recovered = true; cursor.delete(); tx.objectStore('uploads').delete(claim.id);
        const c = tx.objectStore('captures').get(claim.id);
        c.onsuccess = () => {
          if (!c.result) return;
          const recoveries = (c.result.recoveries || 0) + 1;
          tx.objectStore('captures').put({ ...c.result, recoveries,
            ...(recoveries > 3 ? { processingError: 'Separation repeatedly stopped responding. Try CPU compatibility in Settings.', retryAt: undefined } : {}) });
        };
        const parts = tx.objectStore('chunks').index('captureId').openCursor(`output/${claim.id}`);
        parts.onsuccess = () => { const part = parts.result; if (part) { part.delete(); part.continue(); } };
      }
      cursor.continue();
    };
  });
}

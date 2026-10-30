import { queueTransaction } from './queue';
/** Sweep only incomplete transfers whose source document is gone. Never remove a complete recording. */
export function recoverQueue(liveTabs: Set<number>, now = Date.now()) {
  return queueTransaction(['captures', 'chunks', 'claims', 'uploads'], 'readwrite', tx => {
    const captures = tx.objectStore('captures').openCursor();
    captures.onsuccess = () => {
      const cursor = captures.result; if (!cursor) return;
      const c = cursor.value;
      if (!c.complete && !liveTabs.has(c.tabId) && c.tabId !== -1) {
        cursor.delete();
        const chunks = tx.objectStore('chunks').index('captureId').openCursor(c.id);
        chunks.onsuccess = () => { const part = chunks.result; if (part) { part.delete(); part.continue(); } };
      }
      captures.result.continue();
    };
    const claims = tx.objectStore('claims').openCursor();
    claims.onsuccess = () => {
      const cursor = claims.result; if (!cursor) return;
      const c = cursor.value;
      const tab = typeof c.owner === 'string' && /^worker:\d+$/.test(c.owner) ? Number(c.owner.slice(7)) : typeof c.owner === 'number' ? c.owner : null;
      if (c.expires <= now || tab !== null && !liveTabs.has(tab)) {
        cursor.delete(); tx.objectStore('uploads').delete(c.id);
        const chunks = tx.objectStore('chunks').index('captureId').openCursor(`output/${c.id}`);
        chunks.onsuccess = () => { const part = chunks.result; if (part) { part.delete(); part.continue(); } };
      }
      cursor.continue();
    };
  });
}

/** A same-tab page reload replaces its document even though the tab ID is unchanged. */
export function recoverCaptureDocument(tabId: number, documentId: string) {
  return queueTransaction(['captures', 'chunks'], 'readwrite', tx => {
    const r = tx.objectStore('captures').openCursor();
    r.onsuccess = () => {
      const c = r.result; if (!c) return;
      if (c.value.tabId === tabId && !c.value.complete && c.value.documentId !== documentId) {
        c.delete(); const chunks = tx.objectStore('chunks').index('captureId').openCursor(c.value.id);
        chunks.onsuccess = () => { const part = chunks.result; if (part) { part.delete(); part.continue(); } };
      }
      c.continue();
    };
  });
}

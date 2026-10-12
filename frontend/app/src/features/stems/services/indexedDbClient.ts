const DB_NAME = 'ktv420-chord-analysis';
export type CachedChordSnapshot = { time: number; chord: string; confidence: number };
export type CachedChordAnalysisRecord = { md5: string; timeline: CachedChordSnapshot[]; analyzedAt: number; analyzerVersion?: number };
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => request.result.createObjectStore('analyses',{keyPath:'md5'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function cacheChordTimeline(md5: string,timeline: CachedChordSnapshot[],analyzerVersion?: number): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx=db.transaction('analyses','readwrite');
    tx.objectStore('analyses').put({md5,timeline,analyzedAt:Date.now(),analyzerVersion});
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onabort=()=>{db.close();reject(tx.error);};
  });
}
export async function getCachedChordTimeline(md5: string): Promise<CachedChordAnalysisRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx=db.transaction('analyses','readonly');
    const request=tx.objectStore('analyses').get(md5);
    tx.oncomplete=()=>{db.close();resolve(request.result ?? null);};
    tx.onabort=()=>{db.close();reject(tx.error);};
  });
}

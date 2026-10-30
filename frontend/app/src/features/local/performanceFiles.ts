import { parseRecording, type PerformanceRecording } from './recording';
/** Kept separately from audio; owned by the website independently of the Spotify integration. */
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request=indexedDB.open('ktv420-performances',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function savePerformance(key: 'import'|'last'|'draft', value: PerformanceRecording | null) {
  const db=await database();
  try { await new Promise<void>((resolve,reject) => {
    const tx=db.transaction('files','readwrite');
    if(value) tx.objectStore('files').put(value,key);else tx.objectStore('files').delete(key);
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error || new Error('Could not save this recording locally.'));
  }); } finally {db.close();}
}
export async function loadPerformance(key: 'import'|'last'|'draft') {
  const db=await database();
  try { return await new Promise<PerformanceRecording | null>((resolve,reject) => {
    const request=db.transaction('files').objectStore('files').get(key);
    request.onsuccess=()=>{try {resolve(request.result ? parseRecording(request.result) : null);}catch(error){reject(error);}};
    request.onerror=()=>reject(request.error);
  }); } finally {db.close();}
}

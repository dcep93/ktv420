import type { PerformanceRecording } from '../features/local/recording';
import type { ListeningLease } from './listeningLease';

type State = {
  pendingReplay: { tabId: number; recording: PerformanceRecording };
  listeningLease: ListeningLease;
};

// Separate from the audio library so updating coordination metadata never requires
// a library schema upgrade or access to chrome.storage. Connections close on commit
// and records survive service-worker suspension; listening leases expire after 3s.
function openState(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ktv420-extension-state', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function accessState<K extends keyof State>(key: K, update?: (previous: State[K] | undefined) => State[K] | undefined): Promise<State[K] | undefined> {
  const db = await openState();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', update ? 'readwrite' : 'readonly');
    let result: State[K] | undefined;
    let failure: unknown;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Could not save extension state.')); };
    tx.onerror = () => { /* onabort reports the terminal error */ };
    const store = tx.objectStore('state');
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        result = update ? update(request.result) : request.result;
        if (update) {
          if (result === undefined) store.delete(key);
          else store.put(result, key);
        }
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}

export function readState<K extends keyof State>(key: K): Promise<State[K] | undefined> {
  return accessState(key);
}

// Read and write within one transaction so competing Spotify tabs cannot both
// claim playback, or clear a newer replay while finishing an older one.
export function updateState<K extends keyof State>(key: K, update: (previous: State[K] | undefined) => State[K] | undefined): Promise<State[K] | undefined> {
  return accessState(key, update);
}

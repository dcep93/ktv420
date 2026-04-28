const DB_NAME = "stem420-output-cache";
const DB_VERSION = 2;
const OUTPUT_STORE_NAME = "outputs";
const CHORD_STORE_NAME = "chord-analyses";

export type CachedOutputFile = {
  name: string;
  path: string;
  blob: Blob;
};

export type CachedOutputRecord = {
  md5: string;
  files: CachedOutputFile[];
};

export type CachedChordSnapshot = {
  time: number;
  chord: string;
  confidence: number;
};

export type CachedChordAnalysisRecord = {
  md5: string;
  timeline: CachedChordSnapshot[];
  analyzedAt: number;
  analyzerVersion?: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(OUTPUT_STORE_NAME)) {
        db.createObjectStore(OUTPUT_STORE_NAME, { keyPath: "md5" });
      }

      if (!db.objectStoreNames.contains(CHORD_STORE_NAME)) {
        db.createObjectStore(CHORD_STORE_NAME, { keyPath: "md5" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
  });
}

async function runTransaction(
  storeName: string,
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => void
): Promise<void> {
  const db = await openDatabase();

  return await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };

    task(store);
  });
}

export async function cacheMd5Files(
  md5: string,
  files: CachedOutputFile[]
): Promise<void> {
  await runTransaction(OUTPUT_STORE_NAME, "readwrite", (store) => {
    const record: CachedOutputRecord = { md5, files };
    store.put(record);
  });
}

export async function getCachedMd5(md5: string): Promise<CachedOutputRecord | null> {
  const db = await openDatabase();

  return await new Promise<CachedOutputRecord | null>((resolve, reject) => {
    const transaction = db.transaction(OUTPUT_STORE_NAME, "readonly");
    const store = transaction.objectStore(OUTPUT_STORE_NAME);
    const request = store.get(md5);

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB lookup failed"));
    };

    request.onsuccess = () => {
      resolve((request.result as CachedOutputRecord | undefined) ?? null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB get failed"));
    };
  });
}

export async function cachedOutputsExist(md5: string): Promise<boolean> {
  const record = await getCachedMd5(md5);
  return Boolean(record);
}

export async function removeCachedOutputs(md5: string): Promise<void> {
  await Promise.all([
    runTransaction(OUTPUT_STORE_NAME, "readwrite", (store) => {
      store.delete(md5);
    }),
    runTransaction(CHORD_STORE_NAME, "readwrite", (store) => {
      store.delete(md5);
    }),
  ]);
}

export async function clearCachedOutputs(): Promise<void> {
  await Promise.all([
    runTransaction(OUTPUT_STORE_NAME, "readwrite", (store) => {
      store.clear();
    }),
    runTransaction(CHORD_STORE_NAME, "readwrite", (store) => {
      store.clear();
    }),
  ]);
}

export async function cacheChordTimeline(
  md5: string,
  timeline: CachedChordSnapshot[],
  analyzerVersion?: number
): Promise<void> {
  await runTransaction(CHORD_STORE_NAME, "readwrite", (store) => {
    const record: CachedChordAnalysisRecord = {
      md5,
      timeline,
      analyzedAt: Date.now(),
      analyzerVersion,
    };
    store.put(record);
  });
}

export async function getCachedChordTimeline(
  md5: string
): Promise<CachedChordAnalysisRecord | null> {
  const db = await openDatabase();

  return await new Promise<CachedChordAnalysisRecord | null>((resolve, reject) => {
    const transaction = db.transaction(CHORD_STORE_NAME, "readonly");
    const store = transaction.objectStore(CHORD_STORE_NAME);
    const request = store.get(md5);

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB lookup failed"));
    };

    request.onsuccess = () => {
      resolve((request.result as CachedChordAnalysisRecord | undefined) ?? null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB get failed"));
    };
  });
}

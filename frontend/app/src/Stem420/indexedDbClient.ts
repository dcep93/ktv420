const DB_NAME = "stem420-output-cache";
const DB_VERSION = 1;
const STORE_NAME = "outputs";

export type CachedOutputFile = {
  name: string;
  path: string;
  blob: Blob;
};

export type CachedOutputRecord = {
  md5: string;
  files: CachedOutputFile[];
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "md5" });
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
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => void
): Promise<void> {
  const db = await openDatabase();

  return await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

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
  await runTransaction("readwrite", (store) => {
    const record: CachedOutputRecord = { md5, files };
    store.put(record);
  });
}

export async function getCachedMd5(md5: string): Promise<CachedOutputRecord | null> {
  const db = await openDatabase();

  return await new Promise<CachedOutputRecord | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
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
  await runTransaction("readwrite", (store) => {
    store.delete(md5);
  });
}

export async function clearCachedOutputs(): Promise<void> {
  await runTransaction("readwrite", (store) => {
    store.clear();
  });
}

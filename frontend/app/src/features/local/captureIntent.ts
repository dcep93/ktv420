const key = (path: string) => `ktv420:capture-intent:${path}`;
export function readCaptureIntent(path: string, storage?: Pick<Storage, 'getItem'>): string[] | null {
  try {
    const value = JSON.parse((storage ?? sessionStorage).getItem(key(path)) || 'null');
    return Array.isArray(value) && value.length > 0 && value.length <= 10000 &&
      value.every(id => typeof id === 'string' && /^[A-Za-z0-9]{1,100}$/.test(id)) ? value : null;
  } catch { return null; }
}
export function saveCaptureIntent(path: string, ids: string[] | null, storage?: Pick<Storage, 'setItem' | 'removeItem'>) {
  try {
    const store = storage ?? sessionStorage;
    if (ids) store.setItem(key(path), JSON.stringify(ids));
    else store.removeItem(key(path));
  } catch { /* Capture still works when session storage is unavailable. */ }
}

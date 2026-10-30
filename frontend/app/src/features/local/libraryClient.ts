export {
  STEM_NAMES,
  listTracks,
  getTrack,
  getInput,
  getPlaybackRecord,
  setTrackStatus,
  saveMp3,
} from './library';
export type { LocalTrack } from './library';
import { transaction, deleteTrack as removeTrack } from './library';
export const SEPARATION_LOCK = 'ktv420-separation';
export function getProcessingEnabled(): Promise<boolean> {
  return transaction(['settings'], 'readonly', (tx, done) => {
    const read = tx.objectStore('settings').get('processing');
    read.onsuccess = () => done(read.result !== false);
  });
}
export function setProcessingEnabled(enabled: boolean): Promise<void> {
  return transaction(['settings'], 'readwrite', (tx) => {
    tx.objectStore('settings').put(enabled, 'processing');
  });
}
export async function withProcessingLock<T>(run: (acquired: boolean) => Promise<T>): Promise<T> {
  return navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, (lock) => run(!!lock));
}
export async function requestPersistence(): Promise<boolean> {
  return !!(await navigator.storage?.persist?.());
}

export async function deleteTrack(id: string) {
  await navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Pause separation before deleting audio.');
    await removeTrack(id);
  });
}

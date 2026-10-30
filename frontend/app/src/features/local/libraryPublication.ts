import { transaction, type LocalTrack, type StoredAudio } from './library';
import { MP3_NAMES } from './audio/mp3Types';
/** Read files and issue a monotonic revision in the same transaction, across tabs. */
export function libraryPublication() {
  return transaction<{ revision: number; tracks: { id: string; status: LocalTrack['status'] }[] }>(['tracks', 'audio', 'settings'], 'readwrite', (tx, done) => {
    const tracks = tx.objectStore('tracks').getAll(), audio = tx.objectStore('audio').getAll(), prior = tx.objectStore('settings').get('publication-revision');
    prior.onsuccess = () => {
      const revision = Math.max(Date.now() * 1024, (prior.result || 0) + 1);
      tx.objectStore('settings').put(revision, 'publication-revision');
      const files = audio.result as StoredAudio[];
      done({ revision, tracks: (tracks.result as LocalTrack[]).filter(t => t.source === 'spotify' &&
        (t.status !== 'ready' ? files.some(f => f.trackId === t.id && f.blob.size > 0 && /^input\./.test(f.name)) :
          MP3_NAMES.every(name => files.some(f => f.trackId === t.id && f.name === `${name}.mp3` && f.blob.size > 0))))
        .map(({ id, status }) => ({ id, status })) });
    };
  });
}

import { deleteTracks } from '../features/local/library';
import { readState, updateState } from './state';
import { SEPARATION_LOCK, type BrokerLocks } from './libraryBroker';

export async function deleteCollectionAudio(path: unknown, locks: BrokerLocks): Promise<void> {
  if (typeof path !== 'string' || !/^(playlist|album)\/[A-Za-z0-9]{22}$/.test(path)) throw new Error('Invalid catalog collection.');
  const collection = (await readState('collections'))?.find(item => item.path === path);
  if (!collection) throw new Error('Collection is no longer in your catalog.');
  await locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Pause separation before deleting local audio.');
    // Reserve playback ownership while deleting so another Spotify tab cannot
    // start capture between the activity check and the atomic audio deletion.
    const reservation = { tabId: -1, expires: Date.now() + 60000 };
    await updateState('listeningLease', previous => {
      if (previous && previous.expires > Date.now()) throw new Error('Close the ktv420 overlay on Spotify before deleting local audio.');
      return reservation;
    });
    try {
      // Keep the link available for recapture, including older catalog entries.
      await updateState('collections', previous => previous?.map(item => item.path === path
        ? { ...item, startedAt: item.startedAt ?? item.savedAt } : item));
      await deleteTracks(collection.trackIds.map(id => `spotify-${id}`));
    } finally {
      await updateState('listeningLease', previous => previous?.tabId === reservation.tabId && previous.expires === reservation.expires ? undefined : previous);
    }
  });
}

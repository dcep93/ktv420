import { useEffect } from 'react';
import { embeddedSpotify, overlayReady } from '../features/local/spotify/overlay';
import { startStagedProcessing } from '../features/local/spotify/stagedProcessing';
/** No library, player, or view ownership: extension staging is authoritative. */
export default function SeparationWorker() {
  useEffect(() => {
    if (!embeddedSpotify) return;
    overlayReady();
    return startStagedProcessing(() => {}, () => {});
  }, []);
  return null;
}

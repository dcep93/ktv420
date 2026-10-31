import { useEffect } from 'react';
import { embeddedSpotify, overlayReady } from '../features/local/spotify/overlay';
import { startStagedProcessing } from '../features/local/spotify/stagedProcessing';
/** A persistent background owner writes directly to the shared website library. */
export default function SeparationWorker() {
  useEffect(() => {
    if (!embeddedSpotify) return;
    overlayReady();
    return startStagedProcessing(() => {}, () => {});
  }, []);
  return null;
}

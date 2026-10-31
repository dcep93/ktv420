/** Notify readers after committed writes, including other tabs and extension-hosted frames. */
export const libraryChanges = new EventTarget();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('ktv420-library-changes') : null;
if (channel) channel.onmessage = () => libraryChanges.dispatchEvent(new Event('change'));
export function notifyLibraryChanged() {
  libraryChanges.dispatchEvent(new Event('change'));
  channel?.postMessage('change');
}

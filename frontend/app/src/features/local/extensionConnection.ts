export const STORE_ID = 'kmkbecinmhkfihahalgclomhcicmoiia';
export const STORE_URL = `https://chromewebstore.google.com/detail/ktv420/${STORE_ID}`;
export function extensionMessage<T extends { ok: boolean; error?: string; version?: string }>(message: unknown): Promise<T> {
  const requested = new URLSearchParams(location.search).get('extension');
  const id = requested && /^[a-p]{32}$/.test(requested) ? requested : STORE_ID;
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) { reject(new Error('Install the extension, then refresh this page.')); return; }
    const timeout = setTimeout(() => reject(new Error('Update the extension, then refresh this page.')), 8000);
    chrome.runtime.sendMessage(id, message, response => {
      clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error || !response) reject(new Error('Install or update the extension, then refresh this page.'));
      else if (!response.ok) reject(new Error(response.error || 'Update the extension, then refresh this page.'));
      else resolve(response);
    });
  });
}

import { extensionId } from '../extensionConnection';
export function spotifyRequest<T>(
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(
        new Error('Install the Spotify extension, then refresh. Imported music works without it.'),
      );
      return;
    }
    const timer = setTimeout(
      () => reject(new Error('Spotify did not respond. Reload its tab and retry.')),
      90000,
    );
    chrome.runtime.sendMessage(
      extensionId(),
      { protocol: 'ktv420-spotify', version: 1, operation, ...args },
      (response) => {
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error || !response?.ok)
          reject(
            new Error(response?.error || 'Install or update the Spotify extension, then refresh.'),
          );
        else resolve(response.result as T);
      },
    );
  });
}

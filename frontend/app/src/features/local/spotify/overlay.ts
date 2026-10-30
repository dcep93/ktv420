// Only a packaged extension parent can host the capture-enabled view. A query
// string alone must never enable control of an arbitrary Spotify tab.
const parentOrigin = typeof location === 'undefined' ? '' : location.ancestorOrigins?.[0] || '';
export const embeddedSpotify = typeof window !== 'undefined' && window.parent !== window &&
  /^chrome-extension:\/\/[a-p]{32}$/.test(parentOrigin) &&
  new URLSearchParams(location.search).get('overlay') === '1';
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
const requests = new Map<string, Pending>();
if (embeddedSpotify) {
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== parentOrigin || event.data?.source !== 'ktv420-overlay-host') return;
    const message = event.data;
    if (message.type === 'response') {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Spotify did not respond.'));
    } else if (message.type === 'navigation') {
      window.dispatchEvent(new CustomEvent('ktv420:overlay-navigation', { detail: message }));
    }
  });
}
export function overlayReady() {
  if (embeddedSpotify) parent.postMessage({ source: 'ktv420-overlay-app', type: 'ready' }, parentOrigin);
}
export function overlayRequest<T>(request: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('Spotify did not respond. Reload its tab and retry.')); }, 90000);
    requests.set(id, { resolve: value => resolve(value as T), reject, timer });
    parent.postMessage({ source: 'ktv420-overlay-app', type: 'request', id, request }, parentOrigin);
  });
}

// Offscreen lifetime belongs to the extension, never to a Spotify/website tab.
const APP = 'https://ktv420.web.app';
const frame = document.querySelector('iframe');
let session = crypto.randomUUID(), lastActivity = Date.now(), restarting = false;
const allowed = new Set(['hello', 'work-state', 'work-recover', 'work-pending', 'work-claim', 'work-touch', 'work-chunk', 'work-begin', 'work-append', 'work-finish', 'work-failure', 'work-release']);
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== APP || event.data?.source !== 'ktv420-overlay-app') return;
  lastActivity = Date.now(); restarting = false;
  if (event.data.type === 'ready') { session = crypto.randomUUID(); return; }
  if (event.data.type !== 'request' || typeof event.data.id !== 'string' || event.data.id.length > 100 || !allowed.has(event.data.request?.operation)) return;
  const { id, request } = event.data;
  chrome.runtime.sendMessage({ type: 'ktv420:worker-request', session, request }, response => {
    const error = chrome.runtime.lastError;
    frame.contentWindow.postMessage({ source: 'ktv420-overlay-host', type: 'response', id,
      ...(error ? { ok: false, error: error.message } : response) }, APP);
  });
});
frame.src = `${APP}/separation-worker?overlay=1`;

// Covers a failed iframe load or lost page event loop, independent of UI tabs.
setInterval(() => {
  if (Date.now() - lastActivity < 60000 || restarting) return;
  restarting = true; lastActivity = Date.now(); session = crypto.randomUUID();
  frame.src = `${APP}/separation-worker?overlay=1&restart=${Date.now()}`;
  // A failed load gets another bounded interval; no audio is acknowledged/deleted.
  setTimeout(() => { restarting = false; }, 60000);
}, 10000);

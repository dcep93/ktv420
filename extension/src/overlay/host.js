// This packaged frame supplies the storage-partition exemption and a narrow,
// sender-bound relay. The hosted app never receives a Chrome tab ID or API object.
const APP = 'https://ktv420.web.app';
const SPOTIFY = 'https://open.spotify.com';
const frame = document.querySelector('iframe');
const params = new URLSearchParams(location.search);
const id = params.get('id');
if (!/^(album|playlist)\.[A-Za-z0-9]{22}$/.test(id || '')) throw new Error('Invalid playlist.');
const url = new URL('/playlist', APP);
url.searchParams.set('id', id);
url.searchParams.set('overlay', '1');
if (/^[1-9]\d{0,4}$/.test(params.get('ktv420') || '')) url.searchParams.set('ktv420', params.get('ktv420'));
let ready = false;
let state = { source: 'ktv420-overlay-host', type: 'navigation', open: true, trackIndex: Number(params.get('ktv420')) || null };
function postState() { if (ready) frame.contentWindow.postMessage(state, APP); }
window.addEventListener('message', (event) => {
  if (event.source === parent && event.origin === SPOTIFY && event.data?.source === 'ktv420-spotify-host') {
    if (event.data.type !== 'navigation') return;
    state = { source: 'ktv420-overlay-host', type: 'navigation', open: event.data.open === true,
      trackIndex: Number.isSafeInteger(event.data.trackIndex) && event.data.trackIndex > 0 && event.data.trackIndex <= 10000 ? event.data.trackIndex : null };
    postState();
    return;
  }
  if (event.source !== frame.contentWindow || event.origin !== APP || event.data?.source !== 'ktv420-overlay-app') return;
  if (event.data.type === 'ready') { ready = true; postState(); return; }
  if (event.data.type !== 'request' || typeof event.data.id !== 'string' || event.data.id.length > 100) return;
  const requestId = event.data.id;
  // Background validates the operation and derives the Spotify tab from this
  // extension frame's MessageSender, never from remotely supplied arguments.
  chrome.runtime.sendMessage({ type: 'ktv420:overlay-request', request: event.data.request }, (response) => {
    const error = chrome.runtime.lastError;
    frame.contentWindow.postMessage({ source: 'ktv420-overlay-host', type: 'response', id: requestId,
      ...(error ? { ok: false, error: error.message } : response) }, APP);
  });
});
frame.src = url.href;
parent.postMessage({ source: 'ktv420-extension-host', type: 'ready' }, SPOTIFY);

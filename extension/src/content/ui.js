import { collectTrackRows, isSupportedRoute } from './dom.js';
import { SELECTORS } from './constants.js';

const PARENT = 'ktv420-parent';
const FRAME = 'ktv420-overlay';

export function mountButton({ isRunActive, onToggleRun, loadSpotifyTracks }) {
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'ktv420'; button.setAttribute('aria-label', 'Open ktv420');
  Object.assign(button.style, { background: '#211b1a', color: '#f991b3', border: '1px solid #f991b3',
    borderRadius: '20px', padding: '8px 14px', marginLeft: '10px', cursor: 'pointer', fontWeight: '700', zIndex: '2147483647' });
  const overlay = document.createElement('section');
  overlay.setAttribute('aria-label', 'ktv420 Spotify overlay');
  Object.assign(overlay.style, { position: 'fixed', inset: '64px 12px 94px', zIndex: '2147483646',
    background: '#191315', border: '1px solid #f991b3', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 12px 48px #000a', display: 'none' });
  let iframe; let tracks = []; let notice = ''; let error = ''; let starting = false; let route = ''; let refreshing = false;
  function post() {
    iframe?.contentWindow?.postMessage({ source: PARENT, type: 'state', tracks,
      active: isRunActive(), starting, notice, error, supported: isSupportedRoute() }, origin);
  }
  async function updateTracks() {
    if (refreshing || isRunActive()) return;
    refreshing = true;
    try {
      const found = await loadSpotifyTracks();
      tracks = found.length ? found : collectTrackRows();
      route = location.pathname;
      error = '';
    } catch (reason) { error = reason?.message || String(reason); }
    finally { refreshing = false; post(); }
  }
  async function show() {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'ktv420 Spotify player';
      iframe.src = chrome.runtime.getURL('build/index.html?overlay=1');
      iframe.allow = 'autoplay';
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' });
      iframe.addEventListener('load', post);
      overlay.append(iframe);
    }
    overlay.style.display = 'block';
    await updateTracks(); post();
  }
  button.onclick = () => { void show(); };
  function refresh() {
    if (isRunActive()) starting = false;
    const parent = document.querySelector(SELECTORS.spotifyLogo)?.closest('a')?.parentElement;
    const target = parent || document.body;
    if (target && button.parentElement !== target) target.append(button);
    Object.assign(button.style, parent ? { position: 'static' } : { position: 'fixed', top: '12px', right: '20px' });
    if (document.body && !overlay.isConnected) document.body.append(overlay);
    button.textContent = isRunActive() ? 'ktv420 · capturing' : 'ktv420';
    post();
    if (iframe && route !== location.pathname && !isRunActive()) void updateTracks();
  }
  const handleMessage = async event => {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== origin || event.data?.source !== FRAME) return;
    if (event.data.type === 'close') { overlay.style.display = 'none'; return; }
    if (event.data.type === 'ready') { post(); return; }
    if (event.data.type !== 'toggle-capture' || starting) return;
    starting = true; error = ''; post();
    try {
      if (!isRunActive()) await updateTracks();
      // activechange refreshes the button once startup completes, keeping Stop available during capture.
      const run = onToggleRun({ trackSnapshot: tracks });
      post();
      await run;
    } catch (reason) { error = reason?.message || String(reason); }
    finally { starting = false; refresh(); }
  };
  window.addEventListener('message', handleMessage);
  const toolbar = (message, _sender, respond) => {
    if (message?.type !== 'ktv420:show-overlay') return false;
    void show().then(() => respond({ ok: true }), reason => respond({ ok: false, error: String(reason) }));
    return true;
  };
  chrome.runtime.onMessage.addListener(toolbar);
  const timer = setInterval(refresh, 1000);
  refresh();
  window.addEventListener('pagehide', () => {
    clearInterval(timer); window.removeEventListener('message', handleMessage); chrome.runtime.onMessage.removeListener(toolbar);
  }, { once: true });
  return { refresh,
    async notifyTrackCaptured(_id, metadata) { notice = `${metadata?.trackName || 'Track'} captured. Local separation is queued automatically.`; post(); },
    async notifyCaptureComplete(trackIds) { notice = `${trackIds?.length || 0} tracks captured. Separation continues here automatically.`; refresh(); },
  };
}

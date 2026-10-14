import { collectTrackRows, isSupportedRoute } from './dom.js';
import { SELECTORS } from './constants.js';

const PARENT = 'ktv420-parent';
const FRAME = 'ktv420-overlay';
const BUTTON_ID = 'ktv420-spotify-capture-button';
const IFRAME_ID = 'ktv420-prepared-iframe';
const STYLE_ID = 'ktv420-spotify-capture-style';

export function mountButton({ isRunActive, onToggleRun, loadSpotifyTracks }) {
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  const [major, minor] = chrome.runtime.getManifest().version.split('.').map(Number);
  const hostedBridge = major > 0 || minor >= 4;
  injectStyle();
  const button = document.createElement('button');
  button.id = BUTTON_ID; button.type = 'button'; button.setAttribute('aria-label', 'Open ktv420');
  const icon = document.createElement('img'); icon.alt = ''; icon.src = chrome.runtime.getURL('assets/favicon.svg'); button.append(icon);
  const overlay = document.createElement('section');
  overlay.id = IFRAME_ID; overlay.setAttribute('aria-label', 'ktv420 Spotify overlay'); overlay.setAttribute('aria-hidden', 'true');
  let iframe; let tracks = []; let notice = ''; let error = ''; let starting = false; let route = ''; let refreshing = false;
  let frameReady = false;
  let captureProgress = null;
  function post() {
    // A new iframe starts as about:blank with Spotify's origin. Wait until the
    // extension document identifies itself before sending extension-only data.
    if (!frameReady) return;
    // DOM fallback tracks retain their HTML rows for capture. Only metadata can
    // cross the iframe's structured-clone boundary.
    const trackData = tracks.map(({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex }) => ({
      trackId, trackName, trackArtist, trackArtworkSrc, rowIndex,
    }));
    iframe?.contentWindow?.postMessage({ source: PARENT, version: 2, type: 'state', tracks: trackData,
      active: isRunActive(), starting, notice, error, captureProgress, supported: isSupportedRoute() }, origin);
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
      overlay.append(iframe);
    }
    overlay.dataset.open = 'true'; overlay.setAttribute('aria-hidden', 'false');
    await updateTracks(); post();
  }
  button.onclick = () => { void show(); };
  function refresh() {
    if (isRunActive()) starting = false;
    const parent = document.querySelector(SELECTORS.spotifyLogo)?.closest('a')?.parentElement;
    // Wait for Spotify's logo instead of briefly rendering in a fallback position.
    if (parent) {
      if (button.parentElement !== parent) parent.append(button);
    } else button.remove();
    if (document.body && !overlay.isConnected) document.body.append(overlay);
    button.dataset.active = String(isRunActive());
    button.disabled = !isSupportedRoute() && !isRunActive();
    button.title = isRunActive() ? 'ktv420 capture active' : 'Open ktv420';
    post();
    if (iframe && route !== location.pathname && !isRunActive()) void updateTracks();
  }
  const handleMessage = async event => {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== origin || event.data?.source !== FRAME) return;
    if (hostedBridge && event.data.version !== 2) return;
    if (event.data.type === 'close') { overlay.dataset.open = 'false'; overlay.setAttribute('aria-hidden', 'true'); return; }
    if (event.data.type === 'ready') { frameReady = true; post(); return; }
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
    notifyCaptureProgress(progress) { captureProgress = progress; post(); },
    async notifyTrackCaptured(_id, metadata) { notice = `${metadata?.trackName || 'Track'} captured. Local separation is queued automatically.`; post(); },
    async notifyCaptureComplete(trackIds) { notice = `${trackIds?.length || 0} tracks captured. Separation continues here automatically.`; refresh(); },
  };
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      align-items: center;
      background: rgba(20, 15, 12, 0.92);
      border: 1px solid rgba(255, 123, 195, 0.95);
      border-radius: 999px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      height: 36px;
      letter-spacing: 0.03em;
      margin-inline-start: 10px;
      justify-content: center;
      padding: 0;
      vertical-align: middle;
      white-space: nowrap;
      width: 36px;
      z-index: 2147483647;
    }

    #${BUTTON_ID}:hover:not(:disabled) {
      background: rgba(36, 28, 24, 0.94);
      box-shadow: 0 0 0 2px rgba(201, 156, 107, 0.2);
    }

    #${BUTTON_ID}:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    #${BUTTON_ID}[data-active="true"] {
      background: rgba(102, 95, 32, 0.78);
      border-color: #ff9bcf;
      box-shadow: 0 0 0 3px rgba(255, 123, 195, 0.22);
    }

    #${BUTTON_ID} img {
      display: block;
      height: 28px;
      width: 28px;
    }

    #${IFRAME_ID} {
      background: #0c0907;
      border: 0;
      height: 100dvh;
      inset: 0;
      left: 0;
      opacity: 0;
      pointer-events: none;
      position: fixed;
      top: 0;
      visibility: hidden;
      width: 100vw;
      z-index: 2147483647;
    }

    #${IFRAME_ID}[data-open="true"] {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
    }
  `;
  document.documentElement.append(style);
}

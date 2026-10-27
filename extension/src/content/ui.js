import { collectTrackRows, isSupportedRoute } from './dom.js';
import { readOverlayUrl, writeOverlayUrl } from './overlayUrl.js';
import { createCollectionRegistration } from './collectionRegistration.js';
import { SELECTORS } from './constants.js';

const PARENT = 'ktv420-parent';
const FRAME = 'ktv420-overlay';
const BUTTON_ID = 'ktv420-spotify-capture-button';
const IFRAME_ID = 'ktv420-prepared-iframe';
const STYLE_ID = 'ktv420-spotify-capture-style';

function collectionHeader() {
  const header = document.querySelector('[data-testid="entity-header"]');
  const image = header?.querySelector?.('img');
  const artwork = image?.currentSrc || image?.src || '';
  return {
    title: header?.querySelector?.('h1')?.textContent?.trim() || '',
    artwork: /^https:\/\/(?:i|mosaic)\.scdn\.co\//.test(artwork) ? artwork : '',
  };
}


export function mountButton({ isRunActive, onToggleRun, loadSpotifyTracks, onTransport, onHeartbeat, onOpenChange, onReplay, onCancelCapture }) {
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  const frameUrl = chrome.runtime.getURL('build/index.html?overlay=1');
  const [major, minor] = chrome.runtime.getManifest().version.split('.').map(Number);
  const hostedBridge = major > 0 || minor >= 4;
  injectStyle();
  const button = document.createElement('button');
  button.id = BUTTON_ID; button.type = 'button'; button.setAttribute('aria-label', 'Open ktv420');
  const icon = document.createElement('img'); icon.alt = ''; icon.src = chrome.runtime.getURL('assets/favicon.svg'); button.append(icon);
  const overlay = document.createElement('section');
  overlay.id = IFRAME_ID; overlay.setAttribute('aria-label', 'ktv420 Spotify overlay'); overlay.setAttribute('aria-hidden', 'true');
  let connectionStartedAt = 0;
  let iframe; let tracks = []; let notice = ''; let error = ''; let starting = false; let route = ''; let refreshing = false;
  let usingDomTracks = false;
  let frameReady = false, lastTrackRefresh = 0, opening = false;
  let replay = null; let captureRequest = null;
  let urlKey = null;
  let navigation = { revision: 0, open: false, trackIndex: null };
  let collection = null, captureCollection = null;
  let catalogError = '';
  const register = createCollectionRegistration({
    getPath: () => location.pathname,
    send(message, respond) {
      chrome.runtime.sendMessage(message, response => {
        const failure = chrome.runtime.lastError;
        respond(failure ? { ok: false, error: failure.message } : response);
      });
    },
    onError(message) { catalogError = message; post(); },
  });
  const registerCollection = (value = collection, started = false) => register(value, started);
  async function prepareCaptureCollection() {
    const value = collection, revision = navigation.revision;
    const snapshot = tracks;
    captureCollection = value;
    await registerCollection(value, true);
    if (!navigation.open || navigation.revision !== revision || !value ||
      location.pathname.replace(/\/$/, '') !== `/${value.path}`) {
      throw new Error('Capture cancelled because the Spotify view changed.');
    }
    return snapshot;
  }
  function writeView(open, trackIndex = null, replace = false) {
    const href = writeOverlayUrl(location.href, open, trackIndex);
    if (href !== location.href) history[replace ? 'replaceState' : 'pushState'](history.state, '', href);
    urlKey = readOverlayUrl(href).key;
    navigation = { ...navigation, open, trackIndex };
  }
  function readView() {
    const view = readOverlayUrl(location.href);
    if (view.key === urlKey) return;
    if (route !== location.pathname) { catalogError = ''; captureCollection = null; close(false); }
    urlKey = view.key;
    navigation = { revision: navigation.revision + 1, open: view.open, trackIndex: view.trackIndex };
    if (view.open) void show(false).catch(reason => { error = reason?.message || String(reason); post(); });
    else close(false);
    post();
  }
  function hasBrokerDocument() {
    // WindowProxy survives navigation. A previous ready message does not mean
    // it still contains our broker (e.g. srcdoc or extension reload).
    let valid = false;
    try {
      valid = !!chrome.runtime.id && !!iframe?.isConnected && iframe.src === frameUrl &&
        !iframe.hasAttribute('srcdoc') && (!iframe.contentDocument || iframe.contentDocument.URL === frameUrl);
    } catch { /* Invalidated extension context or inaccessible document. */ }
    if (!valid) frameReady = false;
    return valid;
  }
  function sendToFrame(message) {
    if (!hasBrokerDocument() || !frameReady) return;
    iframe.contentWindow.postMessage(message, origin);
  }
  const postReplay = () => { if (replay) sendToFrame({source:PARENT,version:2,type:'replay',recording:replay}); };
  chrome.runtime.sendMessage({type:'ktv420:pending-replay'}, response => {
    if (chrome.runtime.lastError || !response?.ok || !response.result) return;
    replay = response.result; onReplay?.(true); void show(); postReplay();
  });
  let captureProgress = null; let listening = null;
  function post() {
    // A new iframe starts as about:blank with Spotify's origin. Wait until the
    // extension document identifies itself before sending extension-only data.
    if (!hasBrokerDocument() || !frameReady) return;
    // DOM fallback tracks retain their HTML rows for capture. Only metadata can
    // cross the iframe's structured-clone boundary.
    const trackData = tracks.map(({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex }) => ({
      trackId, trackName, trackArtist, trackArtworkSrc, rowIndex,
    }));
    sendToFrame({ source: PARENT, version: 2, type: 'state', spotifyPath: location.pathname.slice(1), navigation, tracks: route === location.pathname ? trackData : [],
      active: isRunActive() || !!listening?.capturing, starting, notice, error: error || catalogError, captureProgress: captureProgress || listening?.captureProgress || null, listening, supported: isSupportedRoute() });
  }
  async function updateTracks() {
    if (refreshing || isRunActive()) return;
    refreshing = true;
    try {
      const path = location.pathname;
      const found = await loadSpotifyTracks();
      if (path !== location.pathname) return;
      const retainRows = usingDomTracks && route === path;
      usingDomTracks = !found.length;
      tracks = found.length ? found : retainRows ? tracks : [];
      if (usingDomTracks) mergeDomRows();
      route = location.pathname;
      collection = { path: route.slice(1).replace(/\/$/, ''), ...collectionHeader(),
        trackIds: tracks.map(track => track.trackId) };
      registerCollection();
      error = '';
    } catch (reason) { error = reason?.message || String(reason); }
    finally { refreshing = false; lastTrackRefresh = Date.now(); prepareRequestedView(); post(); }
  }
  function mergeDomRows() {
    // Spotify hydrates albums in batches and may unmount off-screen rows.
    // Retain known positions, then replace only the rows currently observed.
    const rows = new Map(tracks.map(track => [track.rowIndex, track]));
    for (const track of collectTrackRows()) rows.set(track.rowIndex, track);
    const merged = [...rows.values()].sort((a, b) => a.rowIndex - b.rowIndex);
    const fields = ['trackId', 'trackName', 'trackArtist', 'trackArtworkSrc', 'rowIndex'];
    const changed = merged.length !== tracks.length || merged.some((track, index) =>
      fields.some(field => track[field] !== tracks[index]?.[field]));
    tracks = merged;
    return changed;
  }
  function refreshDomTracks() {
    if (!usingDomTracks || route !== location.pathname || !mergeDomRows()) return;
    if (collection) {
      collection = { ...collection, trackIds: tracks.map(track => track.trackId) };
      if (captureCollection?.path === collection.path) captureCollection = collection;
      registerCollection();
    }
  }
  function prepare() {
    if (!chrome.runtime.id) return;
    // srcdoc (including an empty value) overrides src and destroys the broker.
    // Replace the node so queued messages from its old WindowProxy cannot
    // authenticate the new player. Do not restart a normal about:blank load.
    if (iframe && (!iframe.isConnected || iframe.src !== frameUrl || iframe.hasAttribute('srcdoc'))) {
      frameReady = false;
      iframe.remove();
      iframe = null;
    }
    if (!iframe) {
      connectionStartedAt = Date.now();
      iframe = document.createElement('iframe');
      iframe.title = 'ktv420 Spotify player';
      iframe.src = frameUrl;
      iframe.addEventListener('load', () => { hasBrokerDocument(); });
      iframe.allow = 'autoplay';
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' });
      overlay.append(iframe);
    }
  }
  function hasCurrentTracks() {
    return isSupportedRoute() && route === location.pathname && tracks.length > 0;
  }
  function prepareRequestedView() {
    if (!navigation.open || !isSupportedRoute() || !document.body) return;
    // Load the player alongside Spotify, rather than adding both load times.
    // reveal() still requires current tracks and their rendered acknowledgement.
    if (!overlay.isConnected) document.body.append(overlay);
    prepare(); post();
  }
  async function show(fromButton = true) {
    if (!isSupportedRoute()) return;
    if (fromButton && navigation.open && overlay.dataset.open !== 'true' && iframe) {
      frameReady = false; iframe.remove(); iframe = null;
    }
    if (fromButton) { writeView(true); navigation = { ...navigation, revision: navigation.revision + 1 }; }
    prepareRequestedView();
    await updateTracks();
    prepareRequestedView();
  }
  async function reveal() {
    if (opening || overlay.dataset.open === 'true' || !navigation.open || !hasCurrentTracks()) return;
    opening = true;
    const revision = navigation.revision, path = location.pathname;
    try {
      const paused = navigation.trackIndex !== null;
      await onOpenChange?.(true, { paused });
      if (paused) await onTransport?.({ action: 'pause', bestEffort: true });
      // Back, Escape or Spotify navigation can cancel an opening during activation.
      if (!navigation.open || navigation.revision !== revision || location.pathname !== path || !hasCurrentTracks()) {
        await onOpenChange?.(false); return;
      }
      overlay.dataset.open = 'true'; overlay.setAttribute('aria-hidden', 'false');
    } catch (reason) {
      error = reason?.message || String(reason);
      await onOpenChange?.(false);
      button.title = error;
    } finally { opening = false; }
  }
  function close(updateUrl = true) {
    if (updateUrl) writeView(false);
    if (overlay.dataset.open !== 'true') return;
    overlay.dataset.open = 'false'; overlay.setAttribute('aria-hidden', 'true');
    // Stop Spotify even when the hosted player has not finished loading.
    void Promise.resolve(onTransport?.({ action: 'pause' })).finally(() => {
      if (overlay.dataset.open !== 'true') return onOpenChange?.(false);
    })
      .catch(reason => { error = reason?.message || String(reason); post(); });
    sendToFrame({ source: PARENT, version: 2, type: 'closed' });
    button.focus?.();
  }
  const keydown = event => {
    if (event.key !== 'Escape' || (!navigation.open && overlay.dataset.open !== 'true')) return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  button.onclick = () => { void show(); };
  function refresh(domChanged = false) {
    readView();
    refreshDomTracks();
    if (isRunActive()) starting = false;
    const parent = document.querySelector(SELECTORS.spotifyLogo)?.closest('a')?.parentElement;
    // Wait for Spotify's logo instead of briefly rendering in a fallback position.
    if (parent) {
      if (button.parentElement !== parent) parent.append(button);
    } else button.remove();
    if (document.body && !overlay.isConnected) document.body.append(overlay);
    button.dataset.active = String(isRunActive());
    button.disabled = !isSupportedRoute();
    button.setAttribute('aria-busy', String(navigation.open && overlay.dataset.open !== 'true'));
    button.title = error || catalogError || (isRunActive() ? 'ktv420 capture active' : navigation.open && overlay.dataset.open !== 'true' ? connectionStartedAt && Date.now() - connectionStartedAt > 15000 ? 'Player did not connect. Click k to retry, or reload the extension.' : 'Waiting for Spotify and ktv420' : 'Open ktv420');
    if (iframe && overlay.dataset.open === 'true') prepare();
    if (collection && route === location.pathname && (!collection.title || !collection.artwork)) {
      // Spotify's title and cover hydrate independently. Keep looking for either
      // missing field, without clearing known metadata or writing every tick.
      const header = collectionHeader();
      const title = header.title || collection.title, artwork = header.artwork || collection.artwork;
      if (title !== collection.title || artwork !== collection.artwork) {
        collection = { ...collection, title, artwork };
        if (captureCollection?.path === collection.path) captureCollection = collection;
        registerCollection();
      }
    }
    post();
    const missingTracks = !tracks.length || (navigation.trackIndex !== null && !tracks.some(track => track.rowIndex + 1 === navigation.trackIndex)) || replay?.tracks.some(item => !tracks.some(t => t.trackId === item.id));
    const rowsArrived = domChanged && missingTracks && collectTrackRows().length > 0;
    if (navigation.open && !isRunActive() && (route !== location.pathname || (missingTracks && (rowsArrived || Date.now() - lastTrackRefresh > 1000)))) void updateTracks();
    prepareRequestedView();
  }
  const handleMessage = async event => {
    if (!hasBrokerDocument() || event.source !== iframe.contentWindow || event.origin !== origin || event.data?.source !== FRAME) return;
    if (hostedBridge && event.data.version !== 2) return;
    if (event.data.type === 'view-ready') {
      if (frameReady && event.data.revision === navigation.revision && event.data.spotifyPath === location.pathname.slice(1)) await reveal();
      return;
    }
    if (event.data.type === 'view') {
      const { trackIndex, revision, replace } = event.data;
      if (revision !== navigation.revision || !navigation.open ||
        !(trackIndex === null || Number.isSafeInteger(trackIndex) && tracks.some(track => track.rowIndex + 1 === trackIndex))) return;
      writeView(true, trackIndex, replace === true); post(); return;
    }
    if (event.data.type === 'close') { close(); return; }
    if (event.data.type === 'dismiss-replay') {
      replay = null; onReplay?.(false);
      chrome.runtime.sendMessage({type:'ktv420:clear-replay'}, () => { void chrome.runtime.lastError; });
      sendToFrame({source:PARENT,version:2,type:'replay',recording:null});return;
    }
    if (event.data.type === 'ready') { if (event.data.controller === 'hosted') await onTransport?.({ action: 'hosted-control' }); frameReady = true; post(); postReplay(); return; }
    if (event.data.type === 'listening-heartbeat') { onHeartbeat?.(event.data.captureFraction); return; }
    if (event.data.type === 'transport') { await onTransport?.(event.data.command); return; }
    if (event.data.type === 'capture-cancel') {
      if (captureRequest === event.data.id) { captureRequest = null; await onCancelCapture?.(); }
      return;
    }
    if (event.data.type === 'capture-one') {
      const { id, trackId } = event.data;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
      const respond = (ok, error = '') => sendToFrame({source:PARENT,version:2,type:'capture-result',id,ok,error});
      if (captureRequest || starting || isRunActive() || overlay.dataset.open !== 'true' || !tracks.some(t => t.trackId === trackId)) {
        respond(false, 'Capture is busy or the requested song is unavailable.'); return;
      }
      captureRequest = id; starting = true; error = ''; post();
      try {
        const snapshot = await prepareCaptureCollection();
        if (captureRequest !== id) throw new Error('Capture cancelled.');
        await onToggleRun({trackSnapshot:snapshot,trackIds:[trackId]}); respond(true);
      }
      catch (reason) { error = reason?.message || String(reason); respond(false,error); }
      finally { captureRequest = null; starting = false; refresh(); }
      return;
    }
    if (event.data.type !== 'toggle-capture' || starting) return;
    starting = true; error = ''; post();
    try {
      if (!isRunActive()) await updateTracks();
      // activechange refreshes the button once startup completes, keeping Stop available during capture.
      if (replay && !isRunActive()) {
        const missing = replay.tracks.filter(item => !tracks.some(t => t.trackId === item.id));
        if (missing.length) throw new Error(`Find the required songs in this Spotify page first: ${missing.map(t => t.title).join(', ')}`);
        await onTransport?.({action:'volume',volume:0});
      }
      const snapshot = isRunActive() ? tracks : await prepareCaptureCollection();
      const run = onToggleRun({ trackSnapshot: snapshot, trackIds: replay ? replay.tracks.map(t => t.id) : null });
      post();
      await run;
    } catch (reason) { error = reason?.message || String(reason); }
    finally { starting = false; refresh(); }
  };
  window.addEventListener('message', handleMessage);
  window.addEventListener('keydown', keydown, true);
  const toolbar = (message, _sender, respond) => {
    if (message?.type !== 'ktv420:show-overlay') return false;
    void show().then(() => respond({ ok: true }), reason => respond({ ok: false, error: String(reason) }));
    return true;
  };
  chrome.runtime.onMessage.addListener(toolbar);
  // Spotify renders asynchronously. Coalesce DOM arrivals into one refresh per
  // frame, and stop reacting once the requested rows and logo are available.
  let domRefresh = null;
  const observer = new MutationObserver(() => {
    const needsRows = navigation.open && (!hasCurrentTracks() ||
      (navigation.trackIndex !== null && !tracks.some(track => track.rowIndex + 1 === navigation.trackIndex)));
    if (domRefresh !== null || (button.isConnected && !needsRows)) return;
    domRefresh = requestAnimationFrame(() => { domRefresh = null; refresh(true); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(refresh, 1000);
  queueMicrotask(refresh);
  window.addEventListener('popstate', readView);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    if (domRefresh !== null) cancelAnimationFrame(domRefresh);
    window.removeEventListener('popstate', readView);
    clearInterval(timer); window.removeEventListener('message', handleMessage); window.removeEventListener('keydown', keydown, true); chrome.runtime.onMessage.removeListener(toolbar);
  }, { once: true });
  return { refresh, prepare, getTrackIds: () => tracks.map(track => track.trackId),
    getTrackMetadata: id => tracks.find(track => track.trackId === id),
    notifyListening(state) { if (!listening?.capturing && state?.capturing) { captureCollection = collection; void registerCollection(collection, true); } if (listening?.capturing && !state?.capturing) registerCollection(); listening = state; post(); },
    notifyCaptureProgress(progress) { captureProgress = progress; post(); },
    async notifyTrackCaptured(_id, metadata) { void registerCollection(captureCollection || collection); notice = `${metadata?.trackName || 'Track'} captured. Local separation is queued automatically.`; post(); },
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

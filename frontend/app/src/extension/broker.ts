import { mountTransferBridge } from './transferBridge';
import { parseOverlayNavigation } from '../features/local/overlayNavigation';
import { parseRecording, spotifyContext } from '../features/local/recording';
import { parseListeningState, parseTransportCommand } from '../features/local/listeningProtocol';
import { createLibraryBrokerSession, LIBRARY_PROTOCOL_VERSION } from './libraryBroker';

type MessageWindow = Pick<Window, 'postMessage'>;
type Session = ReturnType<typeof createLibraryBrokerSession>;
type BridgeOptions = {
  parent: MessageWindow; player: MessageWindow; parentOrigin: string; playerOrigin: string;
  standalone?: boolean;
  createSession: () => Session; showError: (message: string) => void; onReady?: () => void;
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validCaptureProgress(value: unknown) {
  return value === undefined || value === null || object(value) &&
    typeof value.trackId === 'string' && value.trackId.length > 0 && value.trackId.length <= 4096 &&
    (value.phase === undefined || value.phase === 'saving') &&
    (value.fraction === null || typeof value.fraction === 'number' && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1);
}
function validState(value: Record<string, unknown>) {
  return value.source === 'ktv420-parent' && value.version === LIBRARY_PROTOCOL_VERSION && value.type === 'state' && Array.isArray(value.tracks) && value.tracks.length <= 10000 &&
    value.tracks.every(track => object(track) &&
      ['trackId', 'trackName', 'trackArtist', 'trackArtworkSrc'].every(key => track[key] === undefined || typeof track[key] === 'string' && track[key].length <= 4096) &&
      (track.rowIndex === undefined || Number.isSafeInteger(track.rowIndex) && Number(track.rowIndex) >= 0)) &&
    typeof value.active === 'boolean' && typeof value.starting === 'boolean' && typeof value.supported === 'boolean' &&
    validCaptureProgress(value.captureProgress) &&
    (value.notice === undefined || typeof value.notice === 'string' && value.notice.length <= 4096) &&
    (value.error === undefined || typeof value.error === 'string' && value.error.length <= 4096);
}

/** No generic forwarding: each direction has a fixed peer, origin and operation allowlist. */
export function createBrokerBridge(options: BridgeOptions) {
  let session = options.createSession(), ready = false, closed = false, loaded = false;
  let state: Record<string, unknown> | undefined;
  let replay: Record<string, unknown> | undefined;
  let resetting = Promise.resolve();
  async function receive(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>): Promise<void> {
    if (closed || !object(event.data)) return;
    const data = event.data;
    if (event.source === options.parent && event.origin === options.parentOrigin) {
      if (data.source === 'ktv420-parent' && data.type === 'state' && data.version !== LIBRARY_PROTOCOL_VERSION) {
        options.showError('Spotify bridge version mismatch. Reload Spotify after updating the extension.'); return;
      }
      if (data.source === 'ktv420-parent' && data.version === LIBRARY_PROTOCOL_VERSION && data.type === 'replay') {
        try { replay = {source:'ktv420-parent',version:2,type:'replay',recording:data.recording===null ? null : parseRecording(data.recording)}; if (ready) options.player.postMessage(replay,options.playerOrigin); }
        catch { options.showError('Invalid recording. Import it again from ktv420.web.app/replay.'); }
        return;
      }
      if (data.source === 'ktv420-parent' && data.version === LIBRARY_PROTOCOL_VERSION && data.type === 'closed') {
        if (ready) options.player.postMessage({ source: 'ktv420-parent', version: LIBRARY_PROTOCOL_VERSION, type: 'closed' }, options.playerOrigin);
        return;
      }
      if (data.source === 'ktv420-parent' && data.version === 2 && data.type === 'capture-result' &&
          typeof data.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.id) && typeof data.ok === 'boolean') {
        if (ready) options.player.postMessage({ source: 'ktv420-parent', version: 2, type: 'capture-result', id: data.id, ok: data.ok,
          error: typeof data.error === 'string' ? data.error.slice(0, 4096) : '' }, options.playerOrigin);
        return;
      }
      if (validState(data)) {
        state = { source: 'ktv420-parent', version: LIBRARY_PROTOCOL_VERSION, type: 'state', active: data.active, starting: data.starting, supported: data.supported,
          spotifyPath: spotifyContext(data.spotifyPath) ? data.spotifyPath : '', notice: data.notice, error: data.error, tracks: (data.tracks as Record<string, unknown>[]).map(track => ({
            trackId: track.trackId, trackName: track.trackName, trackArtist: track.trackArtist,
            trackArtworkSrc: track.trackArtworkSrc, rowIndex: track.rowIndex,
          })) };
        const navigation = parseOverlayNavigation(data.navigation);
        if (navigation) state.navigation = navigation;
        if (data.captureProgress !== undefined) {
          const progress = data.captureProgress as { trackId: string; fraction: number | null; phase?: 'saving' } | null;
          state.captureProgress = progress === null ? null : { trackId: progress.trackId, fraction: progress.fraction, ...(progress.phase === 'saving' ? { phase: 'saving' } : {}) };
        }
        const listening = parseListeningState(data.listening);
        if (listening) state.listening = listening;
        if (ready) options.player.postMessage(state, options.playerOrigin);
      }
      return;
    }
    if (event.source !== options.player || event.origin !== options.playerOrigin) return;
    await resetting;
    if (closed) return;
    if (data.source === 'ktv420-library') {
      if (!ready) return;
      const current = session;
      const result = await current.handle(data);
      if (!closed && current === session) options.player.postMessage(result, options.playerOrigin);
      return;
    }
    if (data.source !== 'ktv420-overlay') return;
    if (options.standalone && !['ready', 'view', 'view-ready', 'close'].includes(String(data.type))) return;
    if (data.version !== LIBRARY_PROTOCOL_VERSION) {
      options.showError('Player bridge version mismatch. Update the extension and reload Spotify.'); return;
    }
    if (data.type === 'ready') {
      ready = true;
      options.onReady?.();
      options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: 'ready', controller: data.controller === 'hosted' ? 'hosted' : undefined }, options.parentOrigin);
      if (state) options.player.postMessage(state, options.playerOrigin);
      if (replay) options.player.postMessage(replay,options.playerOrigin);
    } else if (ready && data.type === 'capture-one' && typeof data.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.id) &&
        typeof data.trackId === 'string' && /^[a-zA-Z0-9]{22}$/.test(data.trackId)) {
      options.parent.postMessage({ source: 'ktv420-overlay', version: 2, type: 'capture-one', id: data.id, trackId: data.trackId }, options.parentOrigin);
    } else if (ready && data.type === 'capture-cancel' && typeof data.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.id)) {
      options.parent.postMessage({ source: 'ktv420-overlay', version: 2, type: 'capture-cancel', id: data.id }, options.parentOrigin);
    } else if (ready && data.type === 'view-ready') {
      const navigation = parseOverlayNavigation(state?.navigation);
      if (navigation?.open && state?.supported && Array.isArray(state.tracks) && state.tracks.length &&
          data.spotifyPath === state.spotifyPath && data.revision === navigation.revision) {
        options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: 'view-ready',
          spotifyPath: state.spotifyPath, revision: navigation.revision }, options.parentOrigin);
      }
    } else if (ready && data.type === 'listening-heartbeat') {
      options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: data.type, ...(data.captureFraction === null || typeof data.captureFraction === 'number' && Number.isFinite(data.captureFraction) && data.captureFraction >= 0 && data.captureFraction <= 1 ? {captureFraction:data.captureFraction} : {}) }, options.parentOrigin);
    } else if (ready && data.type === 'view') {
      const view = parseOverlayNavigation({ revision: data.revision, open: true, trackIndex: data.trackIndex });
      if (view) options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: 'view',
        revision: view.revision, trackIndex: view.trackIndex, replace: data.replace === true }, options.parentOrigin);
    } else if (ready && data.type === 'transport') {
      const command = parseTransportCommand(data.command);
      if (command) options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: 'transport', command }, options.parentOrigin);
    } else if (ready && (data.type === 'dismiss-replay' || data.type === 'close' || data.type === 'toggle-capture')) {
      options.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: data.type, ...(data.captureFraction === null || typeof data.captureFraction === 'number' && Number.isFinite(data.captureFraction) && data.captureFraction >= 0 && data.captureFraction <= 1 ? {captureFraction:data.captureFraction} : {}) }, options.parentOrigin);
    }
  }
  return {
    receive,
    reload(): Promise<void> {
      if (!loaded) {
        loaded = true;
        options.player.postMessage({ source: 'ktv420-broker', version: LIBRARY_PROTOCOL_VERSION, type: 'hello' }, options.playerOrigin);
        return resetting;
      }
      ready = false;
      resetting = resetting.then(async () => {
        await session.dispose();
        if (closed) return;
        session = options.createSession();
        options.player.postMessage({ source: 'ktv420-broker', version: LIBRARY_PROTOCOL_VERSION, type: 'hello' }, options.playerOrigin);
      });
      return resetting;
    },
    async dispose() { closed = true; ready = false; await resetting; await session.dispose(); },
  };
}

function mountBroker() {
  const playerUrl = new URL(import.meta.env.DEV ? `http://127.0.0.1:${location.port}/` : 'https://ktv420.web.app/player/');
  const ownOrigin = location.origin;
  const standalone = new URLSearchParams(location.search).get('standalone') === '1';
  if (standalone) playerUrl.searchParams.set('standalone', '1');
  playerUrl.searchParams.set('brokerOrigin', ownOrigin);
  const parentOrigin = import.meta.env.DEV ? ownOrigin : standalone ? 'https://ktv420.web.app' : 'https://open.spotify.com';
  const player = document.createElement('iframe');
  player.title = 'ktv420 player'; player.allow = 'autoplay'; player.src = playerUrl.href;
  const status = document.createElement('div'); status.className = 'status'; status.hidden = true;
  const text = document.createElement('span');
  const retry = document.createElement('button'); retry.textContent = 'Retry';
  status.append(text, retry);
  document.body.append(player, status);
  let timer: ReturnType<typeof setTimeout>;
  const showError = (message: string) => { text.textContent = message; status.hidden = false; };
  const startTimeout = () => { clearTimeout(timer); timer = setTimeout(() => showError('The hosted player could not connect. Check your connection and retry.'), 12000); };
  const bridge = createBrokerBridge({
    standalone, parent: window.parent, player: player.contentWindow!, parentOrigin, playerOrigin: playerUrl.origin,
    createSession: () => createLibraryBrokerSession({ locks: navigator.locks, preferences: localStorage }),
    showError, onReady: () => { clearTimeout(timer); status.hidden = true; },
  });
  window.addEventListener('message', event => { void bridge.receive(event); });
  // Keep Escape usable when focus is on the bridge's loading/error screen.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    window.parent.postMessage({ source: 'ktv420-overlay', version: LIBRARY_PROTOCOL_VERSION, type: 'close' }, parentOrigin);
  });
  player.addEventListener('load', () => { startTimeout(); void bridge.reload(); });
  player.addEventListener('error', () => showError('The hosted player could not load. Check your connection and retry.'));
  retry.addEventListener('click', () => { status.hidden = true; startTimeout(); player.src = playerUrl.href; });
  window.addEventListener('pagehide', () => { clearTimeout(timer); void bridge.dispose(); });
  startTimeout();
}

if (typeof document !== 'undefined') {
  if (new URLSearchParams(location.search).get('transfer') === '1') mountTransferBridge();
  else mountBroker();
}

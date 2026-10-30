import { createPageBridge } from './pageBridge.js';
import { CaptureOrchestrator } from './orchestrator.js';
import { collectTrackRows, isSupportedRoute, pausePlaybackCleanly } from './dom.js';
import { discoverTrackRows, hasAllRows, trackTotal } from './trackDiscovery.js';
import { readTransportDom } from './transport.js';
import { SELECTORS } from './constants.js';
import { createOverlay } from './overlay.js';

const bridge = createPageBridge(),
  runner = new CaptureOrchestrator({ bridge });
let collection = null,
  tracks = [],
  progress = null,
  current = null,
  volume = null,
  error = '';
const overlay = createOverlay({ onClose: async () => {
  await cancel();
  pausePlaybackCleanly();
} });
bridge.inject().catch((reason) => console.warn('[ktv420] Spotify hooks unavailable', reason));
function header() {
  const element = document.querySelector('[data-testid="entity-header"]'),
    image = element?.querySelector('img');
  return {
    title: element?.querySelector('h1')?.textContent?.trim() || '',
    artwork: image?.currentSrc || image?.src || '',
  };
}
function serialRows(rows) {
  return rows.map(({ trackId, trackName, trackArtist, trackArtworkSrc, rowIndex }) => ({
    trackId,
    trackName,
    trackArtist,
    trackArtworkSrc,
    rowIndex,
  }));
}
async function discover() {
  const path = location.pathname.slice(1).replace(/\/$/, '');
  if (!isSupportedRoute()) throw new Error('Open a Spotify playlist or album.');
  if (runner.isActive()) {
    if (collection?.path !== path) throw new Error('Stop capture before changing playlists.');
    return { collection, tracks, complete: true };
  }
  let rows = collectTrackRows(),
    complete = hasAllRows(rows, trackTotal());
  if (!complete && path.startsWith('playlist/')) {
    try {
      const result = await bridge.command(
        'playlist-tracks',
        { playlistUri: `spotify:playlist:${path.split('/')[1]}` },
        15000,
      );
      if (
        result?.complete &&
        Array.isArray(result.tracks) &&
        (trackTotal() === null || result.tracks.length === trackTotal())
      ) {
        const dom = new Map(rows.map((row) => [row.rowIndex, row]));
        rows = result.tracks.map((row, i) => ({ ...row, rowIndex: i, ...dom.get(i) }));
        complete = true;
      }
    } catch {
      /* DOM discovery below remains authoritative. */
    }
  }
  if (!complete) {
    const found = await discoverTrackRows({
      initial: rows,
      cancelled: () => location.pathname.slice(1) !== path,
    });
    rows = found.tracks;
    complete = found.complete;
  }
  if (location.pathname.slice(1).replace(/\/$/, '') !== path)
    throw new Error('Spotify changed pages during discovery.');
  tracks = serialRows(rows);
  collection = { path, ...header(), trackIds: tracks.map((t) => t.trackId), tracks, complete };
  return { collection, tracks, complete };
}
async function monitor(value) {
  volume = value;
  if (runner.isActive()) await bridge.command('listening-output', { gain: value });
  render();
}
async function capture(request) {
  if (current?.id === request.requestId) return status();
  if (runner.isActive() || current?.state === 'running')
    throw new Error('Another capture is already running.');
  if (
    !collection?.complete ||
    collection.path !== request.path ||
    location.pathname.slice(1).replace(/\/$/, '') !== collection.path
  )
    throw new Error('Discover this Spotify playlist before capturing.');
  const row = tracks.find((t) => t.trackId === request.trackId);
  if (!row) throw new Error('Song is not in this playlist.');
  current = {
    id: request.requestId,
    trackId: row.trackId,
    state: 'running',
    error: '',
    stopped: false,
  };
  error = '';
  progress = null;
  volume ??= readTransportDom().volume ?? 1;
  // The website schedules. This primitive captures exactly one identified song.
  void (async () => {
    try {
      await bridge.command('listening-enable', { enabled: true });
      await bridge.command('listening-output', { gain: volume });
      if (current.stopped) throw new Error('Capture stopped.');
      await runner.run({ trackIds: [row.trackId], trackSnapshot: [row], collection });
    } catch (reason) {
      current.state = 'error';
      current.error = error = reason?.message || String(reason);
    } finally {
      await bridge.command('listening-enable', { enabled: false }).catch(() => {});
      if (current.state === 'running') current.state = 'complete';
      render();
    }
  })();
  render();
  return status();
}
function status() {
  return {
    request: current,
    active: runner.isActive() || current?.state === 'running',
    progress,
    volume: volume ?? readTransportDom().volume ?? 1,
    path: location.pathname.slice(1),
    error,
  };
}
async function cancel() {
  if (current?.state === 'running') {
    current.stopped = true;
    await runner.requestStop();
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'ktv420:show-controls') {
    overlay.show();
    respond({ ok: true });
    return false;
  }
  if (
    message?.type !== 'ktv420:command' ||
    message.protocol !== 'ktv420-spotify' ||
    message.version !== 1
  )
    return false;
  const run = async () => {
    switch (message.operation) {
      case 'close':
        overlay.hide();
        return true;
      case 'view':
        overlay.setView(message.trackIndex, message.replace === true);
        return true;
      case 'presentation':
        overlay.setTitle(message.title);
        return true;
      case 'discover':
        return discover();
      case 'status':
        return status();
      case 'capture':
        return capture(message);
      case 'cancel':
        await cancel();
        return status();
      case 'volume':
        if (!Number.isFinite(message.volume) || message.volume < 0 || message.volume > 1)
          throw new Error('Invalid volume.');
        await monitor(message.volume);
        return status();
      default:
        throw new Error('Unknown Spotify command.');
    }
  };
  void run().then(
    (result) => respond({ ok: true, result }),
    (reason) => respond({ ok: false, error: reason.message || String(reason) }),
  );
  return true;
});
runner.addEventListener('captureprogress', (event) => {
  progress = event.detail;
  render();
});
runner.addEventListener('activechange', render);
function render() {
  if (current?.state === 'running') overlay.setTitle(`${progress?.fraction == null ? '' : `${Math.floor(progress.fraction * 100)}% · `}ktv420`);
}

const button = document.createElement('button');
button.title = 'ktv420';
button.setAttribute('aria-label', 'Open ktv420');
const icon = document.createElement('img');
icon.src = chrome.runtime.getURL('assets/favicon.svg');
icon.alt = 'k';
icon.width = 32;
icon.height = 32;
button.append(icon);
Object.assign(button.style, { background: '#100c09', border: '2px solid #ff7bc3', borderRadius: '50%', width: '40px', height: '40px', padding: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxSizing: 'border-box' });
button.onclick = () => overlay.show();
setInterval(() => {
  const parent = document.querySelector(SELECTORS.spotifyLogo)?.closest('a')?.parentElement;
  if (parent && isSupportedRoute()) {
    if (button.parentElement !== parent) parent.append(button);
  } else button.remove();
}, 750);
window.addEventListener(
  'pagehide',
  () => {
    void runner.requestStop();
    void bridge.command('listening-enable', { enabled: false });
  },
  { once: true },
);

import { readCachedTracks } from './storage.js';
import { createCaptureTitle } from './captureTitle.js';
import { createListeningController } from './listening.js';
import { createPageBridge } from "./pageBridge.js";
import { mountButton } from "./ui.js";

const bridge = createPageBridge();
const captureTitle = createCaptureTitle(document, MutationObserver, chrome.runtime.getURL('assets/favicon.svg'));
// Observe detached media and playlist metadata early; audio routing remains
// disabled until the user explicitly opens ktv420.
bridge.inject().catch((error) => {
  console.warn("[ktv420] Failed to inject page hooks early", error);
});

let captureEpoch = 0, hostedCaptureFraction;
let listening = null;
let orchestrator = null;
let orchestratorPromise = null;

async function getOrchestrator() {
  if (!orchestratorPromise) {
    orchestratorPromise = import("./orchestrator.js").then(({ CaptureOrchestrator }) => {
      orchestrator = new CaptureOrchestrator({ bridge });
      orchestrator.addEventListener("activechange", () => ui.refresh());
      orchestrator.addEventListener("captureoverallprogress", event => captureTitle.set(hostedCaptureFraction === undefined ? event.detail : hostedCaptureFraction));
      orchestrator.addEventListener("captureprogress", (event) => ui.notifyCaptureProgress(event.detail));
      orchestrator.addEventListener("trackstored", (event) => {
        const detail = event.detail || {};
        ui.notifyTrackCaptured(detail.trackId, detail.metadata).catch((error) => {
          console.warn("[ktv420] Failed to report about captured track", error);
        });
      });
      orchestrator.addEventListener("capturecomplete", (event) => {
        const detail = event.detail || {};
        ui.notifyCaptureComplete(detail.trackIds).catch((error) => {
          console.warn("[ktv420] Failed to report about capture completion", error);
        });
      });
      return orchestrator;
    });
  }

  return orchestratorPromise;
}

const ui = mountButton({
  onReplay: enabled => listening?.prepareReplay(enabled),
  onOpenChange: async (open, options) => {
    captureTitle.setOpen(open);
    if (!open) captureEpoch++;
    if (!open && orchestrator?.isActive()) await orchestrator.requestStop();
    await listening?.setEnabled(open, options);
  },
  isRunActive: () => Boolean(orchestrator?.isActive()),
  loadSpotifyTracks: () => loadSpotifyPlaylistTracks(),
  onTransport: command => listening?.command(command),
  onHeartbeat: fraction => { listening?.heartbeat(); if (fraction === null || Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) { hostedCaptureFraction = fraction; captureTitle.set(fraction); } },
  onCancelCapture: async () => { captureEpoch++; await orchestrator?.requestStop(); await listening?.stopCapture(); },
  onToggleRun: async (options = {}) => {
    const epoch = captureEpoch;
    try {
      const runner = await getOrchestrator();
      if (epoch !== captureEpoch) throw new Error('Capture stopped.');
      if (runner.isActive()) { await runner.requestStop(); await listening?.stopCapture(); return; }
      if (!runner.isActive() && listening?.isCapturing()) { await listening.stopCapture(); return; }
      if (!runner.isActive()) await listening?.beforeBatch();
      try {
        if (epoch !== captureEpoch) throw new Error('Capture stopped.');
        await runner.toggleRun(options);
        if (options.trackIds?.length === 1 && !(await readCachedTracks(options.trackIds)).has(options.trackIds[0])) throw new Error('Capture was interrupted. Nothing was saved.');
        if (!runner.handingOff) await listening?.stopCapture();
      }
      catch (error) { if (!runner.handingOff) await listening?.stopCapture(); throw error; }
      finally { listening?.afterBatch(); }
      ui.refresh();
    } catch (error) {
      console.log("[ktv420] Failed to run capture", error);
      throw error;
    }
  }
});

listening = createListeningController({ bridge, emit: state => {
  ui.notifyListening(state);
  if (!orchestrator?.isActive()) captureTitle.set(hostedCaptureFraction === undefined ? state.overallCaptureFraction : hostedCaptureFraction);
}, ensurePlayer: () => ui.prepare(), getRunner: () => orchestrator, getTrackIds: () => ui.getTrackIds(), getTrackMetadata: id => ui.getTrackMetadata(id) });
window.addEventListener('pagehide', () => { listening?.dispose(); captureTitle.dispose(); }, { once: true });

async function loadSpotifyPlaylistTracks() {
  const playlistUri = currentSpotifyPlaylistUri();
  if (!playlistUri) {
    return [];
  }

  const result = await bridge.command("playlist-tracks", { playlistUri }, 15000);
  return result?.ok && Array.isArray(result.tracks) ? result.tracks : [];
}

function currentSpotifyPlaylistUri() {
  const match = window.location.pathname.match(/^\/playlist\/([A-Za-z0-9]+)/);
  return match ? `spotify:playlist:${match[1]}` : "";
}

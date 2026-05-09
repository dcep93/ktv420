import { createPageBridge } from "./pageBridge.js";
import { mountButton } from "./ui.js";

const bridge = createPageBridge();
bridge.inject().catch((error) => {
  console.warn("[ktv420] Failed to inject page hooks early", error);
});

let orchestrator = null;
let orchestratorPromise = null;

async function getOrchestrator() {
  if (!orchestratorPromise) {
    orchestratorPromise = import("./orchestrator.js").then(({ CaptureOrchestrator }) => {
      orchestrator = new CaptureOrchestrator({ bridge });
      orchestrator.addEventListener("activechange", () => ui.refresh());
      orchestrator.addEventListener("trackstored", (event) => {
        const detail = event.detail || {};
        ui.notifyTrackCaptured(detail.trackId, detail.metadata).catch((error) => {
          console.warn("[ktv420] Failed to notify iframe about captured track", error);
        });
      });
      orchestrator.addEventListener("capturecomplete", (event) => {
        const detail = event.detail || {};
        ui.notifyCaptureComplete(detail.trackIds).catch((error) => {
          console.warn("[ktv420] Failed to notify iframe about capture completion", error);
        });
      });
      return orchestrator;
    });
  }

  return orchestratorPromise;
}

const ui = mountButton({
  isRunActive: () => Boolean(orchestrator?.isActive()),
  loadSpotifyTracks: () => loadSpotifyPlaylistTracks(),
  onToggleRun: async (options = {}) => {
    try {
      const runner = await getOrchestrator();
      await runner.toggleRun(options);
      ui.refresh();
    } catch (error) {
      console.log("[ktv420] Failed to run capture", error);
    }
  }
});

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

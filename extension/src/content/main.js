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
      return orchestrator;
    });
  }

  return orchestratorPromise;
}

const ui = mountButton({
  isRunActive: () => Boolean(orchestrator?.isActive()),
  onToggleRun: async () => {
    try {
      const runner = await getOrchestrator();
      await runner.toggleRun();
      ui.refresh();
    } catch (error) {
      console.error("[ktv420] Failed to run capture", error);
    }
  }
});

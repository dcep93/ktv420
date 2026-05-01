import { createPageBridge } from "./pageBridge.js";
import { mountButton } from "./ui.js";

const bridge = createPageBridge();
let orchestrator = null;
let orchestratorPromise = null;

async function getOrchestrator() {
  if (!orchestratorPromise) {
    orchestratorPromise = import("./orchestrator.js").then(({ CaptureOrchestrator }) => {
      orchestrator = new CaptureOrchestrator({ bridge });
      orchestrator.addEventListener("activechange", () => ui.refresh());
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

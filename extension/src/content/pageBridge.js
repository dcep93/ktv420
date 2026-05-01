import { PAGE_EVENT_SOURCE } from "./constants.js";

export function createPageBridge() {
  let mediaSession = null;
  const observations = [];
  let injectPromise = null;
  let nextCommandId = 1;
  const pendingCommands = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== PAGE_EVENT_SOURCE) {
      return;
    }

    const payload = event.data.payload || {};
    if (event.data.event === "command-result") {
      const pending = pendingCommands.get(payload.commandId);
      if (!pending) {
        return;
      }

      pendingCommands.delete(payload.commandId);
      if (payload.ok) {
        pending.resolve(payload.result);
      } else {
        pending.reject(new Error(payload.error || "ktv420 page command failed."));
      }
      return;
    }

    if (event.data.event === "media-session") {
      mediaSession = { ...payload, observedAt: Date.now() };
      return;
    }

    if (event.data.event === "playback-state" && Array.isArray(payload.candidates)) {
      observations.push({ ...payload, observedAt: Date.now() });
      pruneObservations(observations);
    }
  });

  return {
    inject() {
      injectPromise ??= injectPageScript().catch((error) => {
        injectPromise = null;
        throw error;
      });
      return injectPromise;
    },
    async command(command, payload = {}, timeoutMs = 5000) {
      await this.inject();
      const commandId = nextCommandId;
      nextCommandId += 1;

      return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingCommands.delete(commandId);
          reject(new Error(`ktv420 page command timed out: ${command}`));
        }, timeoutMs);

        pendingCommands.set(commandId, {
          resolve: (value) => {
            window.clearTimeout(timeoutId);
            resolve(value);
          },
          reject: (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          }
        });

        window.postMessage(
          {
            source: "ktv420_content",
            command,
            commandId,
            payload
          },
          window.location.origin
        );
      });
    },
    getSnapshot() {
      pruneObservations(observations);
      return {
        mediaSession,
        observations: observations.slice()
      };
    }
  };
}

function injectPageScript() {
  const marker = "ktv420-page-hooks-script";
  if (document.getElementById(marker)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = marker;
    script.src = chrome.runtime.getURL("src/page/spotifyHooks.js");
    script.dataset.ktv420WorkletUrl = chrome.runtime.getURL("src/page/pcmWorklet.js");
    script.async = false;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Could not inject ktv420 Spotify page hooks."));
    };
    (document.documentElement || document.head || document.body).append(script);
  });
}

function pruneObservations(observations) {
  const cutoff = Date.now() - 15000;
  while (observations.length > 0 && observations[0].observedAt < cutoff) {
    observations.shift();
  }

  if (observations.length > 60) {
    observations.splice(0, observations.length - 60);
  }
}

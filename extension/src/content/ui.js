import { SELECTORS } from "./constants.js";
import { collectTrackRows, isSupportedRoute } from "./dom.js";
import { inspectTrackArtifact, readTrackArtifact } from "./storage.js";

const BUTTON_ID = "ktv420-spotify-capture-button";
const IFRAME_ID = "ktv420-prepared-iframe";
const STYLE_ID = "ktv420-spotify-capture-style";
const LOCAL_IFRAME_SRC = "http://localhost:5173/iframe";
const PROD_IFRAME_SRC = "https://ktv420.web.app/iframe";
const STEM_API_BASE_URL = "https://stem420-854199998954.us-east1.run.app";
const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";
const PREPARE_JOB_MESSAGE = "ktv420:prepare-job";
const RUN_JOB_MESSAGE = "ktv420:run-job";
const REQUEST_LOCAL_DATABASE_MESSAGE = "ktv420:request-local-database";
const DELETE_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:delete-local-database-entry";
const LOCAL_DATABASE_MESSAGE = "ktv420:local-database";
const PREPARE_JOB_RESULT_MESSAGE = "ktv420:prepare-job-result";
const RUN_JOB_RESULT_MESSAGE = "ktv420:run-job-result";

export function mountButton({ isRunActive, onToggleRun }) {
  injectStyle();

  const iframeSrc = getIframeSrc();
  const iframeOrigin = new URL(iframeSrc).origin;
  const button = createButton(() => showIframeOverlayWithTracks(iframeSrc, iframeOrigin));
  let scheduled = false;

  const place = () => {
    try {
      const logo = document.querySelector(SELECTORS.spotifyLogo);
      const parent = logo?.closest("a")?.parentElement;
      if (parent && button.parentElement !== parent) {
        parent.append(button);
      }

      if (parent) {
        ensurePreparedIframe(iframeSrc);
      }

      updateButton(button, isRunActive());
    } catch (error) {
      console.warn("[ktv420] Could not place Spotify button", error);
    }
  };

  const schedulePlace = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      place();
    });
  };

  const observer = new MutationObserver(schedulePlace);

  const observeWhenReady = () => {
    if (!document.body) {
      window.requestAnimationFrame(observeWhenReady);
      return;
    }

    observer.observe(document.body, { childList: true, subtree: true });
    schedulePlace();
  };

  observeWhenReady();
  window.addEventListener("popstate", schedulePlace, { passive: true });
  window.addEventListener("hashchange", schedulePlace, { passive: true });

  const intervalId = window.setInterval(schedulePlace, 1000);
  const handleIframeMessage = async (event) => {
    const iframe = document.getElementById(IFRAME_ID);
    if (!(iframe instanceof HTMLIFrameElement)) {
      return;
    }

    if (event.source !== iframe.contentWindow || event.origin !== iframeOrigin) {
      return;
    }

    const message = event.data;
    if (!message || message.source !== IFRAME_MESSAGE_SOURCE) {
      return;
    }

    if (message.type === CLOSE_OVERLAY_MESSAGE) {
      hideIframeOverlay();
      return;
    }

    if (message.type === TOGGLE_RUN_MESSAGE) {
      await onToggleRun();
      schedulePlace();
      return;
    }

    if (message.type === PREPARE_JOB_MESSAGE && typeof message.trackId === "string") {
      await prepareTrackJob(message.trackId, iframe, iframeOrigin);
      return;
    }

    if (message.type === RUN_JOB_MESSAGE && typeof message.trackId === "string") {
      await runTrackJob(message.trackId, iframe, iframeOrigin);
      return;
    }

    if (message.type === REQUEST_LOCAL_DATABASE_MESSAGE) {
      if (!isProd()) {
        await postLocalDatabaseToIframe(iframe, iframeOrigin);
      }
      return;
    }

    if (message.type === DELETE_LOCAL_DATABASE_ENTRY_MESSAGE && typeof message.path === "string") {
      if (!isProd()) {
        await deleteLocalDatabaseEntryAndRefresh(message.path, iframe, iframeOrigin);
      }
    }
  };

  window.addEventListener("message", handleIframeMessage);

  return {
    refresh: schedulePlace,
    disconnect: () => {
      observer.disconnect();
      window.clearInterval(intervalId);
      window.removeEventListener("popstate", schedulePlace);
      window.removeEventListener("hashchange", schedulePlace);
      window.removeEventListener("message", handleIframeMessage);
      button.remove();
      document.getElementById(IFRAME_ID)?.remove();
    }
  };
}

function createButton(onClick) {
  const existing = document.getElementById(BUTTON_ID);
  if (existing instanceof HTMLButtonElement) {
    return existing;
  }

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.setAttribute("aria-label", "ktv420 capture");
  button.innerHTML = `<img alt="" src="${chrome.runtime.getURL("assets/favicon.svg")}" />`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick().catch((error) => {
      console.error("[ktv420] Failed to open prepared iframe", error);
    });
  });
  return button;
}

async function showIframeOverlayWithTracks(src, origin) {
  const iframe = showIframeOverlay(src);
  const tracks = await collectIframeTracks();
  await postTracksToIframe(iframe, origin, tracks);
}

function showIframeOverlay(src) {
  const iframe = ensurePreparedIframe(src);
  iframe.dataset.open = "true";
  iframe.setAttribute("aria-hidden", "false");
  iframe.removeAttribute("tabindex");
  iframe.focus();
  return iframe;
}

function hideIframeOverlay() {
  const iframe = document.getElementById(IFRAME_ID);
  if (!(iframe instanceof HTMLIFrameElement)) {
    return;
  }

  iframe.dataset.open = "false";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
}

function updateButton(button, active) {
  const supported = isSupportedRoute();
  button.disabled = !supported && !active;
  button.dataset.active = active ? "true" : "false";
  button.title = active
    ? "Stop ktv420 capture run"
    : supported
      ? "Start ktv420 capture run"
      : "ktv420 only runs on Spotify album and playlist pages";
  button.setAttribute("aria-label", active ? "Stop ktv420 capture run" : "ktv420 capture");
}

function ensurePreparedIframe(src) {
  const existing = document.getElementById(IFRAME_ID);
  if (existing instanceof HTMLIFrameElement) {
    return existing;
  }

  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = src;
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.addEventListener("load", () => {
    iframe.dataset.loaded = "true";
  });
  document.body.append(iframe);
  return iframe;
}

async function collectIframeTracks() {
  const rows = collectTrackRows();
  const tracks = [];

  for (const row of rows) {
    const artifact = await inspectTrackArtifact(row.trackId).catch((error) => ({
      opfsState: "broken",
      metadata: null,
      error: error?.message || String(error)
    }));

    const track = {
      rowIndex: row.rowIndex,
      opfsState: artifact.opfsState,
      metadata: artifact.metadata,
      ...(artifact.error ? { error: artifact.error } : {})
    };

    if (!hasDisplayFields(artifact.metadata)) {
      Object.assign(track, {
        trackId: row.trackId,
        trackName: row.trackName,
        trackArtist: row.trackArtist,
        trackArtworkSrc: row.trackArtworkSrc
      });
    }

    tracks.push(track);
  }

  return tracks;
}

function hasDisplayFields(metadata) {
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    typeof metadata.trackId === "string" &&
    typeof metadata.trackName === "string" &&
    typeof metadata.trackArtist === "string" &&
    typeof metadata.trackArtworkSrc === "string"
  );
}

async function postTracksToIframe(iframe, origin, tracks) {
  await waitForIframeLoad(iframe);
  iframe.contentWindow?.postMessage(
    {
      source: PARENT_MESSAGE_SOURCE,
      type: TRACKS_MESSAGE,
      isDev: !isProd(),
      tracks
    },
    origin
  );
}

async function postLocalDatabaseToIframe(iframe, origin) {
  try {
    const entries = await collectLocalDatabaseEntries();
    postLocalDatabaseResult(iframe, origin, {
      sourceName: "Spotify content script",
      entries
    });
  } catch (error) {
    postLocalDatabaseResult(iframe, origin, {
      sourceName: "Spotify content script",
      entries: [],
      error: error?.message || String(error)
    });
  }
}

async function deleteLocalDatabaseEntryAndRefresh(path, iframe, origin) {
  try {
    await deleteLocalDatabaseEntry(path);
    await postLocalDatabaseToIframe(iframe, origin);
  } catch (error) {
    postLocalDatabaseResult(iframe, origin, {
      sourceName: "Spotify content script",
      entries: [],
      error: error?.message || String(error)
    });
  }
}

async function prepareTrackJob(trackId, iframe, origin) {
  try {
    const result = await prepareTrackRequest(trackId);
    postActionResult(iframe, origin, PREPARE_JOB_RESULT_MESSAGE, trackId, { ok: true, result });
  } catch (error) {
    postActionResult(iframe, origin, PREPARE_JOB_RESULT_MESSAGE, trackId, {
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function runTrackJob(trackId, iframe, origin) {
  try {
    const request = await prepareTrackRequest(trackId);

    if (!request) {
      postActionResult(iframe, origin, RUN_JOB_RESULT_MESSAGE, trackId, {
        ok: false,
        error: "MP3 is still preparing. Try again after prepare finishes."
      });
      return;
    }

    const result = await postJson(`${STEM_API_BASE_URL}/run_job`, request, "run_job");
    postActionResult(iframe, origin, RUN_JOB_RESULT_MESSAGE, trackId, { ok: true, result });
  } catch (error) {
    postActionResult(iframe, origin, RUN_JOB_RESULT_MESSAGE, trackId, {
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function prepareTrackRequest(trackId) {
  const artifact = await readTrackArtifact(trackId);
  return await postJson(
    `${STEM_API_BASE_URL}/prepare_job`,
    {
      pcm_s16le_b64: artifact.pcmS16leB64,
      metadata: artifact.metadata
    },
    "prepare_job"
  );
}

async function postJson(url, payload, label) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  const result = parseJsonSafely(responseText);

  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status} ${response.statusText}: ${responseText}`);
  }

  return result;
}

function postActionResult(iframe, origin, type, trackId, result) {
  iframe.contentWindow?.postMessage(
    {
      source: PARENT_MESSAGE_SOURCE,
      type,
      trackId,
      ...result
    },
    origin
  );
}

function postLocalDatabaseResult(iframe, origin, result) {
  iframe.contentWindow?.postMessage(
    {
      source: PARENT_MESSAGE_SOURCE,
      type: LOCAL_DATABASE_MESSAGE,
      ...result
    },
    origin
  );
}

async function collectLocalDatabaseEntries() {
  const root = await navigator.storage.getDirectory();
  const entries = [];

  await collectOpfsDirectoryEntries(root, "", entries);
  return entries.sort(compareDatabaseEntries);
}

async function deleteLocalDatabaseEntry(path) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  const entryName = parts.pop();

  if (!entryName) {
    throw new Error("OPFS path must include an entry name.");
  }

  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: false });
  }

  await directory.removeEntry(entryName, { recursive: true });
}

async function collectOpfsDirectoryEntries(directory, prefix, entries) {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      entries.push({ path, kind: "directory" });
      await collectOpfsDirectoryEntries(handle, path, entries);
      continue;
    }

    const file = await handle.getFile();
    entries.push({
      path,
      kind: "file",
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      ...(isJsonPath(path) ? { text: await file.text() } : {})
    });
  }
}

function compareDatabaseEntries(a, b) {
  return a.path.localeCompare(b.path);
}

function isJsonPath(path) {
  return path.toLowerCase().endsWith(".json");
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function waitForIframeLoad(iframe) {
  if (iframe.dataset.loaded === "true") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    iframe.addEventListener("load", resolve, { once: true });
  });
}

function getIframeSrc() {
  return isProd() ? PROD_IFRAME_SRC : LOCAL_IFRAME_SRC;
}

function isProd() {
  return new URLSearchParams(window.location.search).has("prod");
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
      background: #111;
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
      background: #201019;
      box-shadow: 0 0 0 2px rgba(255, 123, 195, 0.2);
    }

    #${BUTTON_ID}:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    #${BUTTON_ID}[data-active="true"] {
      background: #4b071f;
      border-color: #ff9bcf;
      box-shadow: 0 0 0 3px rgba(255, 123, 195, 0.22);
    }

    #${BUTTON_ID} img {
      display: block;
      height: 28px;
      width: 28px;
    }

    #${IFRAME_ID} {
      background: #05070d;
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

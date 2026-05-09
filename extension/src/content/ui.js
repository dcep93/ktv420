import { SELECTORS } from "./constants.js";
import { collectTrackRows, isSupportedRoute } from "./dom.js";
import { deleteTrackArtifact, inspectTrackArtifact, readTrackArtifact } from "./storage.js";

const BUTTON_ID = "ktv420-spotify-capture-button";
const IFRAME_ID = "ktv420-prepared-iframe";
const STYLE_ID = "ktv420-spotify-capture-style";
const LOCAL_IFRAME_SRC = "http://localhost:5173/iframe";
const PROD_IFRAME_SRC = "https://ktv420.web.app/iframe";
const STEM_API_BASE_URL = "https://stem420-854199998954.us-east1.run.app";
const GCS_BUCKET_NAME = "stem420-bucket";
const GCS_UPLOAD_BASE_URL = "https://storage.googleapis.com/upload/storage/v1";
const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";
const ENQUEUE_TRACK_MESSAGE = "ktv420:enqueue-track";
const REQUEST_LOCAL_DATABASE_MESSAGE = "ktv420:request-local-database";
const DELETE_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:delete-local-database-entry";
const INSPECT_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:inspect-local-database-entry";
const DELETE_TRACK_ARTIFACT_MESSAGE = "ktv420:delete-track-artifact";
const LOCAL_DATABASE_MESSAGE = "ktv420:local-database";
const TRACK_CAPTURED_MESSAGE = "ktv420:track-captured";
const CAPTURE_COMPLETE_MESSAGE = "ktv420:capture-complete";
const ENQUEUE_TRACK_RESULT_MESSAGE = "ktv420:enqueue-track-result";

const queuedTrackPromises = new Map();

export function mountButton({ isRunActive, onToggleRun, loadSpotifyTracks = async () => [] }) {
  injectStyle();

  const iframeSrc = getIframeSrc();
  const iframeOrigin = new URL(iframeSrc).origin;
  const button = createButton(() => showIframeOverlayWithTracks(iframeSrc, iframeOrigin, loadSpotifyTracks));
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
      await onToggleRun({
        trackIds: Array.isArray(message.trackIds)
          ? message.trackIds.filter((trackId) => typeof trackId === "string" && trackId)
          : null
      });
      schedulePlace();
      return;
    }

    if (message.type === ENQUEUE_TRACK_MESSAGE && typeof message.trackId === "string") {
      await enqueueTrackJob(message.trackId, iframe, iframeOrigin);
      return;
    }

    if (message.type === REQUEST_LOCAL_DATABASE_MESSAGE) {
      await postLocalDatabaseToIframe(iframe, iframeOrigin);
      return;
    }

    if (message.type === DELETE_LOCAL_DATABASE_ENTRY_MESSAGE && typeof message.path === "string") {
      await deleteLocalDatabaseEntryAndRefresh(message.path, iframe, iframeOrigin);
      return;
    }

    if (message.type === INSPECT_LOCAL_DATABASE_ENTRY_MESSAGE && typeof message.path === "string") {
      await inspectLocalDatabaseEntry(message.path);
      return;
    }

    if (message.type === DELETE_TRACK_ARTIFACT_MESSAGE && typeof message.trackId === "string") {
      await deleteTrackArtifactAndNotify(message.trackId, iframe, iframeOrigin);
    }
  };

  window.addEventListener("message", handleIframeMessage);

  return {
    refresh: schedulePlace,
    notifyTrackCaptured: async (trackId, metadata) => {
      const iframe = document.getElementById(IFRAME_ID);
      if (!(iframe instanceof HTMLIFrameElement)) {
        return;
      }

      let queueError = "";
      let isRemoteProcessing = false;
      try {
        await enqueueTrackForProcessing(trackId);
        isRemoteProcessing = true;
      } catch (error) {
        queueError = error?.message || String(error);
        console.warn(`[ktv420] Failed to enqueue captured track ${trackId}`, error);
      }
      await postTrackCapturedToIframe(iframe, iframeOrigin, trackId, metadata, queueError, isRemoteProcessing);
    },
    notifyCaptureComplete: async (trackIds) => {
      const iframe = document.getElementById(IFRAME_ID);
      if (!(iframe instanceof HTMLIFrameElement)) {
        return;
      }

      await postCaptureCompleteToIframe(iframe, iframeOrigin, trackIds);
    },
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
  button.setAttribute("aria-label", "Open ktv420");
  button.innerHTML = `<img alt="" src="${chrome.runtime.getURL("assets/favicon.svg")}" />`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick().catch((error) => {
      console.log("[ktv420] Failed to open prepared iframe", error);
    });
  });
  return button;
}

async function showIframeOverlayWithTracks(src, origin, loadSpotifyTracks) {
  const iframe = showIframeOverlay(src);
  const tracks = await collectIframeTracks(loadSpotifyTracks);
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
    ? "ktv420 capture active"
    : supported
      ? "Open ktv420"
      : "ktv420 works on Spotify album and playlist pages";
  button.setAttribute("aria-label", active ? "ktv420 capture active" : "Open ktv420");
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

async function collectIframeTracks(loadSpotifyTracks) {
  const spotifyTracks = await loadSpotifyTracks().catch((error) => {
    console.warn("[ktv420] Failed to load Spotify playlist tracks from page API", error);
    return [];
  });
  const rows = spotifyTracks.length > 0 ? spotifyTracks : collectTrackRows();
  const tracks = [];

  for (const row of rows) {
    tracks.push(await collectIframeTrack(row));
  }

  return tracks;
}

async function collectIframeTrack(row) {
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

  return track;
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
      spotifyPath: currentSpotifyPath(),
      tracks
    },
    origin
  );
}

function currentSpotifyPath() {
  return window.location.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
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

async function deleteTrackArtifactAndNotify(trackId, iframe, origin) {
  try {
    await deleteLocalDatabaseEntry(trackId);
  } catch (error) {
    console.warn(`[ktv420] Failed to delete local capture artifact for ${trackId}`, error);
  }

  await postTrackCapturedToIframe(iframe, origin, trackId, null);
}

async function postTrackCapturedToIframe(iframe, origin, trackId, metadata, queueError = "", isRemoteProcessing = false) {
  if (typeof trackId !== "string" || !trackId) {
    return;
  }

  await waitForIframeLoad(iframe);

  const rows = collectTrackRows();
  const row = rows.find((candidate) => candidate.trackId === trackId);
  const artifact = await inspectTrackArtifact(trackId).catch((error) => ({
    opfsState: "broken",
    metadata: metadata || null,
    error: error?.message || String(error)
  }));
  const artifactMetadata = artifact.metadata || metadata || null;

  iframe.contentWindow?.postMessage(
    {
      source: PARENT_MESSAGE_SOURCE,
      type: TRACK_CAPTURED_MESSAGE,
      track: {
        trackId,
        trackName: row?.trackName || artifactMetadata?.trackName || "",
        trackArtist: row?.trackArtist || artifactMetadata?.trackArtist || "",
        trackArtworkSrc: row?.trackArtworkSrc || artifactMetadata?.trackArtworkSrc || "",
        rowIndex: row?.rowIndex ?? -1,
        opfsState: artifact.opfsState,
        isRemoteProcessing,
        metadata: artifactMetadata,
        ...(artifact.error || queueError ? { error: artifact.error || queueError } : {})
      }
    },
    origin
  );
}

async function postCaptureCompleteToIframe(iframe, origin, trackIds) {
  await waitForIframeLoad(iframe);
  iframe.contentWindow?.postMessage(
    {
      source: PARENT_MESSAGE_SOURCE,
      type: CAPTURE_COMPLETE_MESSAGE,
      trackIds: Array.isArray(trackIds)
        ? trackIds.filter((trackId) => typeof trackId === "string" && trackId)
        : []
    },
    origin
  );
}

async function enqueueTrackJob(trackId, iframe, origin) {
  try {
    const result = await enqueueTrackForProcessing(trackId);
    postActionResult(iframe, origin, ENQUEUE_TRACK_RESULT_MESSAGE, trackId, { ok: true, result });
  } catch (error) {
    postActionResult(iframe, origin, ENQUEUE_TRACK_RESULT_MESSAGE, trackId, {
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function enqueueTrackForProcessing(trackId) {
  if (queuedTrackPromises.has(trackId)) {
    return await queuedTrackPromises.get(trackId);
  }

  const promise = enqueueTrackForProcessingOnce(trackId).catch((error) => {
    queuedTrackPromises.delete(trackId);
    throw error;
  });
  queuedTrackPromises.set(trackId, promise);
  return await promise;
}

async function enqueueTrackForProcessingOnce(trackId) {
  const artifact = await readTrackArtifact(trackId);
  const pcmPath = await uploadPreparedPcm(trackId, artifact);
  const queuePath = await uploadQueueItem(trackId, artifact, pcmPath);
  await deleteUploadedTrackArtifact(trackId);
  const processQueueResult = await postJson(`${STEM_API_BASE_URL}/process_queue`, undefined, "process_queue");

  return {
    queuePath,
    processQueueResult
  };
}

async function deleteUploadedTrackArtifact(trackId) {
  try {
    await deleteTrackArtifact(trackId);
  } catch (error) {
    console.warn(`[ktv420] Failed to delete uploaded local capture artifact for ${trackId}`, error);
  }
}

async function uploadPreparedPcm(trackId, artifact) {
  const md5 = artifact.metadata?.md5;
  if (typeof md5 !== "string" || !md5) {
    throw new Error("Cannot upload prepared PCM because metadata.md5 is missing.");
  }

  const pcmBytes = base64ToBytes(artifact.pcmS16leB64);
  const pcmPath = `stems/${trackId}/pcm/${md5}.pcm`;
  const uploadUrl = `${GCS_UPLOAD_BASE_URL}/b/${GCS_BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(pcmPath)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream"
    },
    body: new Blob([pcmBytes], { type: "application/octet-stream" })
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`pcm upload failed with ${response.status} ${response.statusText}: ${responseText}`);
  }

  return pcmPath;
}

async function uploadQueueItem(trackId, artifact, pcmPath) {
  const createdAtMs = Date.now();
  const queuePath = `queue/pending/${createdAtMs}.json`;
  const queueItem = {
    version: 1,
    created_at_ms: createdAtMs,
    track_id: trackId,
    pcm_path: `gs://${GCS_BUCKET_NAME}/${pcmPath}`,
    metadata: artifact.metadata
  };
  const uploadUrl = `${GCS_UPLOAD_BASE_URL}/b/${GCS_BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(queuePath)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(queueItem)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`queue upload failed with ${response.status} ${response.statusText}: ${responseText}`);
  }

  return queuePath;
}

function base64ToBytes(value) {
  const chunkSize = 0x8000;
  const chunks = [];
  let byteLength = 0;

  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const chunk = atob(value.slice(offset, offset + chunkSize));
    const bytes = new Uint8Array(chunk.length);

    for (let index = 0; index < chunk.length; index += 1) {
      bytes[index] = chunk.charCodeAt(index);
    }

    chunks.push(bytes);
    byteLength += bytes.byteLength;
  }

  const output = new Uint8Array(byteLength);
  let outputOffset = 0;

  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }

  return output;
}

async function postJson(url, payload, label) {
  const request = {
    method: "POST",
    headers: {}
  };
  if (payload !== undefined) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(payload);
  }
  const response = await fetch(url, request);
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

async function inspectLocalDatabaseEntry(path) {
  try {
    const contents = await readLocalDatabaseEntry(path);
    console.log("[ktv420] OPFS file contents", {
      path,
      contents: parseJsonSafely(contents)
    });
  } catch (error) {
    console.warn(`[ktv420] Failed to inspect local database entry ${path}`, error);
  }
}

async function readLocalDatabaseEntry(path) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("OPFS path must include a file name.");
  }

  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: false });
  }

  const handle = await directory.getFileHandle(fileName, { create: false });
  const file = await handle.getFile();
  return await file.text();
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
  return !(new URLSearchParams(window.location.search)).has("dev")
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

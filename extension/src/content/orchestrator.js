import { startPreciseCapture, captureTiming } from './preciseCapture.js';
import { CaptureRunProgress } from "./captureTitle.js";
import { STORAGE_VERSION } from "./constants.js";
import {
  clickSkipForward,
  collectTrackRows,
  dispatchSyntheticDoubleClick,
  isSupportedRoute,
  pausePlaybackCleanly,
  resolveTrackRow,
  scrollTracklistToStart
} from "./dom.js";
import { resolveCurrentPlaybackTrack } from "./playbackState.js";
import { readCachedTracks, writeTrackArtifact } from "./storage.js";
import { markTiming, normalizeTimingTrace } from "./timing.js";
import { formatSeconds, looselyMatches } from "./text.js";
import { md5Hex } from "./md5.js";

const START_TIMEOUT_MS = 3000;
const END_TOLERANCE_SECONDS = 0.25;
const PROGRESS_INTERVAL_MS = 250;

export class CaptureOrchestrator extends EventTarget {
  constructor({ bridge }) {
    super();
    this.bridge = bridge;
    this.active = false;
    this.stopRequested = false;
    this.captureProgress = null;
    this.lastProgressAt = -Infinity;
    this.overallProgress = new CaptureRunProgress(fraction => this.dispatchEvent(new CustomEvent("captureoverallprogress", { detail: fraction })));
  }

  isActive() {
    return this.active;
  }

  async toggleRun(options = {}) {
    if (this.active) {
      await this.requestStop();
      return;
    }

    await this.run(options);
  }

  handoff() { if (this.active) { this.stopRequested = true; this.handingOff = true; this.clearCaptureProgress(); this.overallProgress.reset(); } }

  async requestStop() {
    this.stopRequested = true;
    this.overallProgress.reset();
    this.clearCaptureProgress();
    pausePlaybackCleanly();
  }

  async run({ trackIds = null, trackSnapshot = null, timingTrace = null } = {}) {
    if (this.active) {
      return;
    }

    const runTimingTrace = normalizeTimingTrace(timingTrace);
    markTiming(runTimingTrace, "orchestrator_run_start", {
      requestedTrackCount: Array.isArray(trackIds) ? trackIds.length : null
    });

    this.active = true;
    this.handingOff = false;
    this.stopRequested = false;
    this.clearCaptureProgress();
    this.dispatchEvent(new Event("activechange"));

    const debug = {
      extension: "ktv420",
      startedAt: new Date().toISOString(),
      route: window.location.href,
      storageVersion: STORAGE_VERSION,
      timingTrace: runTimingTrace,
      events: []
    };

    const summary = [];
    const queuedTrackIds = [];
    let hasLoggedFirstStartTiming = false;

    try {
      if (!isSupportedRoute()) {
        throw new Error("ktv420 runs only on Spotify album and playlist routes.");
      }

      markTiming(runTimingTrace, "orchestrator_preflight_start");
      const queue = await this.preflightQueue(debug, trackIds, trackSnapshot);
      this.throwIfStopped();
      this.overallProgress.begin(queue);
      markTiming(runTimingTrace, "orchestrator_preflight_end", {
        queueCount: queue.length,
        cachedCount: queue.filter((item) => item.cached).length
      });
      if (queue.length === 0) {
        throw new Error(trackIds
          ? "No requested Spotify track rows need PCM capture on this page."
          : "No Spotify track rows were found on this page.");
      }

      if (queue.every((item) => item.cached)) {
        for (const item of queue) {
          queuedTrackIds.push(item.trackId);
          summary.push({
            alreadyInLocalStorage: true,
            metadata: item.cachedMetadata
          });
          this.dispatchTrackStored(item.trackId, item.cachedMetadata);
        }

        debug.events.push({ type: "all-cached", trackCount: queue.length, at: Date.now() });
        this.dispatchCaptureComplete(queuedTrackIds);
        markTiming(runTimingTrace, "spotify_capture_all_cached", {
          trackCount: queue.length
        });
        console.log("[ktv420] Capture run complete", summary);
        return;
      }

      markTiming(runTimingTrace, "page_hooks_inject_start");
      await this.bridge.inject();
      markTiming(runTimingTrace, "page_hooks_inject_end");

      let firstRow = resolveTrackRow(queue[0]);
      if (!firstRow) {
        markTiming(runTimingTrace, "tracklist_scroll_to_start_start");
        scrollTracklistToStart();
        firstRow = await waitForTrackRow(queue[0], 150);
        markTiming(runTimingTrace, "tracklist_scroll_to_start_end");
      }

      if (!firstRow) {
        throw new Error("Could not resolve the first queued track row.");
      }

      debug.events.push({ type: "start-first-row", trackId: queue[0].trackId, at: Date.now() });
      markTiming(runTimingTrace, "spotify_first_row_resolved", {
        trackId: queue[0].trackId,
        cached: Boolean(queue[0].cached)
      });
      dispatchSyntheticDoubleClick(firstRow);
      markTiming(runTimingTrace, "spotify_first_row_doubleclick_dispatched", {
        trackId: queue[0].trackId
      });

      let startInfo = null;
      for (let index = 0; index < queue.length; index += 1) {
        this.throwIfStopped();
        const item = queue[index];
        const nextItem = queue[index + 1] || null;

        if (!startInfo) {
          startInfo = await this.beginAndAcceptItem(item, debug, {
            logFirstStartTiming: !hasLoggedFirstStartTiming
          });
          hasLoggedFirstStartTiming = true;
        }

        let pendingCapture = null;
        if (item.cached) {
          this.clearCaptureProgress();
          queuedTrackIds.push(item.trackId);
          summary.push({
            alreadyInLocalStorage: true,
            metadata: item.cachedMetadata
          });
          debug.events.push({ type: "skip-cached", trackId: item.trackId, at: Date.now() });
          this.dispatchTrackStored(item.trackId, item.cachedMetadata);
        } else {
          const captureEnd = await this.recordUntilBoundary(item, startInfo, debug);
          pendingCapture = { captureEnd, item };
        }

        startInfo = null;
        if (pendingCapture) {
          // Save this complete track before preparing another, so a failed next
          // seek cannot discard good audio. Pause the new song while transferring.
          pausePlaybackCleanly();
          pendingCapture.capture = await this.finishPageCapture();
          const metadata = await this.storeCapturedTrack(pendingCapture.item, pendingCapture.capture, pendingCapture.captureEnd);
          queuedTrackIds.push(pendingCapture.item.trackId);
          summary.push({
            alreadyInLocalStorage: false,
            metadata
          });
          debug.events.push({
            type: "stored-track",
            trackId: pendingCapture.item.trackId,
            audioByteLength: metadata.audioByteLength,
            at: Date.now()
          });
          this.dispatchTrackStored(pendingCapture.item.trackId, metadata);
        }
        if (nextItem) {
          if (item.cached) clickSkipForward();
          startInfo = await this.beginAndAcceptItem(nextItem, debug, {
            logFirstStartTiming: !hasLoggedFirstStartTiming
          });
          hasLoggedFirstStartTiming = true;
        }

      }

      pausePlaybackCleanly();
      this.dispatchCaptureComplete(queuedTrackIds);
      console.log("[ktv420] Capture run complete", summary);
    } catch (error) {
      this.clearCaptureProgress();
      if (!this.handingOff) pausePlaybackCleanly();
      await this.bridge.command("capture-abort").catch(() => {});
      // A remote track/seek handoff intentionally continues in the listening
      // controller; it is not a user Stop and must not show a stopped error.
      if (this.handingOff && this.stopRequested) return;
      markTiming(runTimingTrace, "orchestrator_run_error", {
        error: error?.message || String(error)
      });

      const report = {
        ...debug,
        failedAt: new Date().toISOString(),
        error: serializeError(error),
        mediaSession: this.bridge.getSnapshot().mediaSession,
        routePathname: window.location.pathname
      };

      if (!hasTimingOutcome(runTimingTrace)) {
        markTiming(runTimingTrace, "spotify_first_track_start_failed", {
          error: error?.message || String(error)
        });
      }
      console.log("[ktv420] Capture run failed", report);
      throw error;
    } finally {
      this.overallProgress.reset();
      this.clearCaptureProgress();
      await this.bridge.command("capture-abort").catch(() => {});
      this.active = false;
      this.stopRequested = false;
      this.dispatchEvent(new Event("activechange"));
    }
  }

  async preflightQueue(debug, trackIds = null, trackSnapshot = null) {
    const requestedTrackIds = new Set(Array.isArray(trackIds) ? trackIds : []);
    const shouldFilterTracks = requestedTrackIds.size > 0;
    let rows = normalizeTrackSnapshot(trackSnapshot);

    if (rows.length > 0) {
      markTiming(debug.timingTrace, "preflight_spotify_tracks_load_skipped", {
        trackCount: rows.length,
        source: "iframe_snapshot"
      });
    } else {
      markTiming(debug.timingTrace, "preflight_spotify_tracks_load_start");
      const spotifyTracks = await this.loadSpotifyTracks();
      markTiming(debug.timingTrace, "preflight_spotify_tracks_load_end", {
        trackCount: spotifyTracks.length
      });
      rows = spotifyTracks.length > 0 ? spotifyTracks : collectTrackRows();
    }

    const queue = [];
    // The player keeps repeated playlist positions; capture each audio file once.
    const seen = new Set();
    const candidateRows = rows.filter(row => {
      if (seen.has(row.trackId) || (shouldFilterTracks && !requestedTrackIds.has(row.trackId))) return false;
      seen.add(row.trackId); return true;
    });
    const candidateTrackIds = candidateRows.map((row) => row.trackId);

    markTiming(debug.timingTrace, "preflight_local_cache_scan_start", {
      trackCount: candidateTrackIds.length
    });
    const cachedTracks = await readCachedTracks(candidateTrackIds);
    markTiming(debug.timingTrace, "preflight_local_cache_scan_end", {
      cachedCount: cachedTracks.size
    });

    for (const row of candidateRows) {
      const cachedMetadata = cachedTracks.get(row.trackId) ?? null;
      queue.push({
        ...row,
        cached: Boolean(cachedMetadata),
        cachedMetadata
      });
    }

    debug.events.push({
      type: "preflight",
      trackCount: queue.length,
      pageTrackCount: rows.length,
      requestedTrackCount: shouldFilterTracks ? requestedTrackIds.size : null,
      cachedCount: queue.filter((item) => item.cached).length,
      at: Date.now()
    });

    return queue;
  }

  async loadSpotifyTracks() {
    const playlistUri = currentSpotifyPlaylistUri();
    if (!playlistUri) {
      return [];
    }

    try {
      const result = await this.bridge.command("playlist-tracks", { playlistUri }, 15000);
      return result?.ok && Array.isArray(result.tracks) ? result.tracks : [];
    } catch (error) {
      console.warn("[ktv420] Failed to load Spotify playlist tracks from page API", error);
      return [];
    }
  }

  dispatchTrackStored(trackId, metadata) {
    if (!this.stopRequested) this.overallProgress.update(trackId, 1);
    if (this.captureProgress?.trackId === trackId) this.clearCaptureProgress();
    this.dispatchEvent(
      new CustomEvent("trackstored", {
        detail: {
          trackId,
          metadata
        }
      })
    );
  }

  dispatchCaptureComplete(trackIds) {
    this.clearCaptureProgress();
    this.dispatchEvent(
      new CustomEvent("capturecomplete", {
        detail: {
          trackIds
        }
      })
    );
  }

  updateCaptureProgress(item, mediaState, now = performance.now()) {
    if (this.stopRequested) return;
    const { duration, currentTime } = mediaState;
    // Unknown media timing is indeterminate. Never imply that PCM is persisted
    // merely because playback reached the boundary.
    const fraction = Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)
      ? Math.min(0.99, Math.max(0, currentTime / duration)) : null;
    const previous = this.captureProgress;
    if (previous?.trackId === item.trackId &&
      (previous.fraction === fraction || now - this.lastProgressAt < PROGRESS_INTERVAL_MS)) return;
    this.overallProgress.update(item.trackId, fraction);
    this.captureProgress = { trackId: item.trackId, fraction };
    this.lastProgressAt = now;
    this.dispatchEvent(new CustomEvent("captureprogress", { detail: this.captureProgress }));
  }

  clearCaptureProgress() {
    if (this.captureProgress === null) return;
    this.captureProgress = null;
    this.lastProgressAt = -Infinity;
    this.dispatchEvent(new CustomEvent("captureprogress", { detail: null }));
  }

  async beginAndAcceptItem(item, debug, { logFirstStartTiming = false } = {}) {
    try {
      // Identify the requested song first. The initial playhead may be anywhere;
      // exact start verification happens after pause + seek below.
      await this.waitForExpectedTrackStart(item, debug);
      if (item.cached) return { currentTime: 0, source: 'cached' };
      const result = await startPreciseCapture({ bridge: this.bridge, trackId: item.trackId,
        checkCancelled: () => this.throwIfStopped() });
      const startInfo = { acceptedAt: Date.now(), currentTime: result.target.currentTime, source: result.target.source };
      debug.events.push({ type: 'verified-zero-start', trackId: item.trackId, ...startInfo });
      if (logFirstStartTiming) markTiming(debug.timingTrace, 'spotify_first_track_started', startInfo);
      return startInfo;
    } catch (error) {
      await this.bridge.command('capture-abort').catch(() => {});
      throw error;
    }
  }

  async waitForExpectedTrackStart(item, debug) {
    const deadline = performance.now() + START_TIMEOUT_MS;
    let lastResolved = null;

    while (performance.now() <= deadline) {
      this.throwIfStopped();
      const snapshot = this.bridge.getSnapshot();
      const current = resolveCurrentPlaybackTrack(snapshot);
      lastResolved = current;

      if (current?.trackId === item.trackId) {
        const { media: mediaState } = await this.bridge.command("listening-state");
        if (!mediaState) { await delay(50); continue; }
        const currentTime = safeCurrentTime(mediaState);

        const mediaArtworkSrc = mediaSessionMatchesItem(snapshot.mediaSession, item)
          ? largestArtworkSrc(snapshot.mediaSession?.artwork)
          : "";
        item.trackArtworkSrc = mediaArtworkSrc || item.trackArtworkSrc || "";

        debug.events.push({
          type: "accepted-start",
          trackId: item.trackId,
          currentTime,
          source: current.source,
          at: Date.now()
        });

        markTiming(debug.timingTrace, "spotify_expected_track_accepted", {
          trackId: item.trackId,
          currentTime,
          source: current.source
        });

        return {
          acceptedAt: Date.now(),
          currentTime,
          source: current.source
        };
      }

      await delay(50);
    }

    throw new Error(
      `Spotify did not switch to expected track ${item.trackName} (${item.trackId}) within 3s. Last resolved: ${JSON.stringify(lastResolved)}`
    );
  }

  async recordUntilBoundary(item, startInfo, debug) {
    const initialState = await this.bridge.command("capture-state");
    const sourceAtStart = initialState.source;
    const duration = safeDuration(initialState);
    let lastMediaTime = safeCurrentTime(initialState);
    let ignoredNetworkTrackId = null;
    this.updateCaptureProgress(item, initialState);

    debug.events.push({
      type: "recording-started",
      trackId: item.trackId,
      source: sourceAtStart,
      duration,
      startInfo,
      at: Date.now()
    });

    while (true) {
      this.throwIfStopped();
      const now = performance.now();
      const mediaState = await this.bridge.command("capture-state");
      const currentSource = mediaState.source;
      const currentTime = safeCurrentTime(mediaState);

      if (currentSource && sourceAtStart && currentSource !== sourceAtStart) {
        if (isAtEnd(lastMediaTime, duration)) {
          return {
            endMediaTime: Math.min(lastMediaTime, duration),
            duration,
            reason: "source-changed-at-end"
          };
        }

        throw new Error(`Spotify media source changed during ${item.trackName}.`);
      }

      // The page capture freezes its ended state. Spotify's metadata may already
      // describe the next song, especially after a delayed background-tab poll.
      if (mediaState.ended) {
        return {
          endMediaTime: Math.min(currentTime || lastMediaTime, duration),
          duration,
          reason: "media-ended"
        };
      }

      if (currentTime + END_TOLERANCE_SECONDS < lastMediaTime) {
        if (isAtEnd(lastMediaTime, duration)) {
          return {
            endMediaTime: Math.min(lastMediaTime, duration),
            duration,
            reason: "time-reset-at-end"
          };
        }

        throw new Error(`Spotify seeked backward unexpectedly during ${item.trackName}.`);
      }

      if (currentTime > lastMediaTime) {
        lastMediaTime = currentTime;
      }

      const snapshot = this.bridge.getSnapshot();
      const current = resolveCurrentPlaybackTrack(snapshot);
      if (current?.trackId && current.trackId !== item.trackId) {
        if (mediaSessionMatchesItem(snapshot.mediaSession, item)) {
          this.updateCaptureProgress(item, mediaState, now);
          if (ignoredNetworkTrackId !== current.trackId) {
            ignoredNetworkTrackId = current.trackId;
            debug.events.push({
              type: "ignored-network-track-disagreement",
              expectedTrackId: item.trackId,
              networkTrackId: current.trackId,
              mediaSessionTitle: snapshot.mediaSession?.title || "",
              mediaSessionArtist: snapshot.mediaSession?.artist || "",
              at: Date.now()
            });
          }
          await delay(100);
          continue;
        }

        if (isAtEnd(lastMediaTime, duration)) {
          return {
            endMediaTime: Math.min(lastMediaTime, duration),
            duration,
            reason: "track-changed-at-end",
            nextTrackId: current.trackId
          };
        }

        throw new Error(`Spotify changed to ${current.trackId} before ${item.trackName} reached the end.`);
      }

      this.updateCaptureProgress(item, mediaState, now);
      // Pausing near the end is still a pause. Wait for ended/transition rather
      // than finalizing early and discarding the last few milliseconds.

      await delay(100);
    }
  }

  async finishPageCapture() {
    const capture = await this.bridge.command("capture-finish", {}, 60000);
    return this.normalizePageCapture(capture);
  }

  normalizePageCapture(capture) {
    const bytes = new Uint8Array(capture.bytesBuffer || new ArrayBuffer(0));
    return {
      bytes,
      byteLength: bytes.byteLength,
      sampleRate: capture.sampleRate,
      channelCount: capture.channelCount,
      startMediaTime: capture.startMediaTime,
      startVerified: capture.startVerified,
      endVerified: capture.endVerified,
      mediaDuration: capture.mediaDuration,
      rawCapturedFrames: capture.rawCapturedFrames,
      invalid: capture.invalid,
      invalidReason: capture.invalidReason
    };
  }

  async storeCapturedTrack(item, capture, captureEnd) {
    const timing = captureTiming(capture, captureEnd.duration);
    const captureWithHash = {
      ...capture,
      md5: md5Hex(capture.bytes)
    };
    const metadata = { ...buildMetadata(item, captureWithHash, captureEnd), ...timing };
    await writeTrackArtifact(item.trackId, capture.bytes, metadata);
    return metadata;
  }

  throwIfStopped() {
    if (this.stopRequested) {
      throw new Error("Capture run stopped by user.");
    }
  }
}

function buildMetadata(item, capture, captureEnd) {
  const duration = Number.isFinite(captureEnd.duration) ? captureEnd.duration : captureEnd.endMediaTime;
  const startTrim = capture.startMediaTime;
  const endTrim = Math.max(0, duration - captureEnd.endMediaTime);

  return {
    storageVersion: STORAGE_VERSION,
    trackId: item.trackId,
    trackName: item.trackName,
    trackArtist: item.trackArtist,
    trackArtworkSrc: item.trackArtworkSrc || "",
    audioSampleRate: capture.sampleRate,
    audioChannelCount: capture.channelCount,
    audioChannelLayout: "interleaved",
    audioSampleFormat: "PCM_F32LE",
    audioByteLength: capture.byteLength,
    crop: `${formatSeconds(startTrim)}-${formatSeconds(endTrim)}`,
    md5: capture.md5
  };
}

function isAtEnd(currentTime, duration) {
  return Number.isFinite(duration) && duration > 0 && duration - currentTime <= END_TOLERANCE_SECONDS;
}

function safeCurrentTime(element) {
  return Number.isFinite(element?.currentTime) ? Math.max(0, element.currentTime) : 0;
}

function safeDuration(element) {
  return Number.isFinite(element?.duration) ? Math.max(0, element.duration) : Number.NaN;
}

function currentSpotifyPlaylistUri() {
  const match = window.location.pathname.match(/^\/playlist\/([A-Za-z0-9]+)/);
  return match ? `spotify:playlist:${match[1]}` : "";
}

async function waitForTrackRow(track, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let row = resolveTrackRow(track);

  while (!row && performance.now() < deadline) {
    await nextAnimationFrame();
    row = resolveTrackRow(track);
  }

  return row;
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function normalizeTrackSnapshot(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((track) => {
      if (!track || typeof track !== "object") {
        return null;
      }

      const trackId = readString(track.trackId);
      const trackName = readString(track.trackName);
      if (!trackId || !trackName) {
        return null;
      }

      return {
        trackId,
        trackName,
        trackArtist: readString(track.trackArtist),
        trackArtworkSrc: readString(track.trackArtworkSrc),
        rowIndex: Number.isFinite(track.rowIndex) ? track.rowIndex : 0
      };
    })
    .filter(Boolean);
}

function readString(value) {
  return typeof value === "string" ? value : "";
}

function hasTimingOutcome(trace) {
  return Boolean(
    trace?.events?.some((event) =>
      event.name === "spotify_first_track_started" ||
      event.name === "spotify_capture_all_cached" ||
      event.name === "spotify_first_track_start_failed"
    )
  );
}

function summarizePageTiming(events) {
  if (!Array.isArray(events)) {
    return "";
  }

  return events
    .filter((event) => event && typeof event.name === "string" && Number.isFinite(event.deltaMs))
    .map((event) => `${event.name}:${event.deltaMs}`)
    .join(",");
}

function mediaSessionMatchesItem(mediaSession, item) {
  if (!mediaSession?.title) {
    return false;
  }

  const nameMatches = looselyMatches(item.trackName, mediaSession.title);
  const artistMatches =
    !item.trackArtist ||
    !mediaSession.artist ||
    looselyMatches(item.trackArtist, mediaSession.artist);

  return nameMatches && artistMatches;
}

function largestArtworkSrc(artwork) {
  if (!Array.isArray(artwork)) {
    return "";
  }

  return artwork
    .map((item) => ({
      src: item?.src || "",
      size: artworkSize(item?.sizes)
    }))
    .filter((item) => item.src)
    .sort((a, b) => b.size - a.size)[0]?.src || "";
}

function artworkSize(sizes) {
  const match = String(sizes || "").match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) {
    return 0;
  }

  return Number(match[1]) * Number(match[2]);
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null
  };
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

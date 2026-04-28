import { STORAGE_VERSION } from "./constants.js";
import { bytesToBase64 } from "./capture.js";
import {
  clickSkipForward,
  collectTrackRows,
  dispatchSyntheticDoubleClick,
  isSupportedRoute,
  pausePlaybackCleanly,
  resolveTrackRow
} from "./dom.js";
import { resolveCurrentPlaybackTrack } from "./playbackState.js";
import { copyJsonToClipboard } from "./clipboard.js";
import { readCachedTrack, writeTrackArtifact } from "./storage.js";
import { formatSeconds, looselyMatches } from "./text.js";
import { md5Hex } from "./md5.js";

const START_TIMEOUT_MS = 1000;
const PAUSE_TIMEOUT_MS = 1000;
const END_TOLERANCE_SECONDS = 0.25;

export class CaptureOrchestrator extends EventTarget {
  constructor({ bridge }) {
    super();
    this.bridge = bridge;
    this.active = false;
    this.stopRequested = false;
  }

  isActive() {
    return this.active;
  }

  async toggleRun() {
    if (this.active) {
      await this.requestStop();
      return;
    }

    await this.run();
  }

  async requestStop() {
    this.stopRequested = true;
    pausePlaybackCleanly();
  }

  async run() {
    if (this.active) {
      return;
    }

    this.active = true;
    this.stopRequested = false;
    this.dispatchEvent(new Event("activechange"));

    const debug = {
      extension: "ktv420",
      startedAt: new Date().toISOString(),
      route: window.location.href,
      storageVersion: STORAGE_VERSION,
      events: []
    };

    const summary = [];

    try {
      await this.bridge.inject();

      if (!isSupportedRoute()) {
        throw new Error("ktv420 runs only on Spotify album and playlist routes.");
      }

      const queue = await this.preflightQueue(debug);
      if (queue.length === 0) {
        throw new Error("No Spotify track rows were found on this page.");
      }

      const firstRow = resolveTrackRow(queue[0]);
      if (!firstRow) {
        throw new Error("Could not resolve the first queued track row.");
      }

      debug.events.push({ type: "start-first-row", trackId: queue[0].trackId, at: Date.now() });
      dispatchSyntheticDoubleClick(firstRow);

      let startInfo = null;
      for (let index = 0; index < queue.length; index += 1) {
        this.throwIfStopped();
        const item = queue[index];
        const nextItem = queue[index + 1] || null;

        if (!startInfo) {
          startInfo = await this.beginAndAcceptItem(item, debug);
        }

        let pendingCapture = null;
        if (item.cached) {
          summary.push({
            alreadyInLocalStorage: true,
            metadata: item.cachedMetadata
          });
          debug.events.push({ type: "skip-cached", trackId: item.trackId, at: Date.now() });
        } else {
          const captureEnd = await this.recordUntilBoundary(item, startInfo, debug);
          pendingCapture = { captureEnd, item };
        }

        startInfo = null;
        if (nextItem) {
          if (item.cached) {
            clickSkipForward();
            debug.events.push({ type: "skip-forward", fromTrackId: item.trackId, at: Date.now() });
            startInfo = await this.beginAndAcceptItem(nextItem, debug);
          } else {
            const { finished } = await this.finishAndBeginNextCapture();
            pendingCapture.capture = finished;
            startInfo = await this.beginAndAcceptItem(nextItem, debug, { captureAlreadyBegun: true });
          }
        } else if (pendingCapture) {
          pendingCapture.capture = await this.finishPageCapture();
        }

        if (pendingCapture) {
          const metadata = await this.storeCapturedTrack(pendingCapture.item, pendingCapture.capture, pendingCapture.captureEnd);
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
        }
      }

      pausePlaybackCleanly();
      await copyJsonToClipboard(summary);
      console.log("[ktv420] Capture run complete", summary);
    } catch (error) {
      pausePlaybackCleanly();
      await this.bridge.command("capture-abort").catch(() => {});

      const report = {
        ...debug,
        failedAt: new Date().toISOString(),
        error: serializeError(error),
        mediaSession: this.bridge.getSnapshot().mediaSession,
        routePathname: window.location.pathname
      };

      await copyJsonToClipboard(report).catch((clipboardError) => {
        report.clipboardError = serializeError(clipboardError);
      });
      console.error("[ktv420] Capture run failed", report);
    } finally {
      await this.bridge.command("capture-abort").catch(() => {});
      this.active = false;
      this.stopRequested = false;
      this.dispatchEvent(new Event("activechange"));
    }
  }

  async preflightQueue(debug) {
    const rows = collectTrackRows();
    const queue = [];

    for (const row of rows) {
      const cachedMetadata = await readCachedTrack(row.trackId);
      queue.push({
        ...row,
        cached: Boolean(cachedMetadata),
        cachedMetadata
      });
    }

    debug.events.push({
      type: "preflight",
      trackCount: queue.length,
      cachedCount: queue.filter((item) => item.cached).length,
      at: Date.now()
    });

    return queue;
  }

  async beginAndAcceptItem(item, debug, { captureAlreadyBegun = false } = {}) {
    if (!captureAlreadyBegun) {
      await this.bridge.command("capture-begin", { timeoutMs: START_TIMEOUT_MS }, START_TIMEOUT_MS + 1000);
    }

    try {
      const startInfo = await this.waitForExpectedTrackStart(item, debug);
      if (!item.cached) {
        await this.bridge.command("capture-mark-start");
      } else {
        await this.bridge.command("capture-abort");
      }
      return startInfo;
    } catch (error) {
      await this.bridge.command("capture-abort").catch(() => {});
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
        const mediaState = await this.bridge.command("capture-state");
        const currentTime = safeCurrentTime(mediaState);
        if (currentTime >= 1) {
          throw new Error(`Spotify started ${item.trackName} too far in (${currentTime.toFixed(3)}s).`);
        }

        debug.events.push({
          type: "accepted-start",
          trackId: item.trackId,
          currentTime,
          source: current.source,
          at: Date.now()
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
      `Spotify did not switch to expected track ${item.trackName} (${item.trackId}) within 1s. Last resolved: ${JSON.stringify(lastResolved)}`
    );
  }

  async recordUntilBoundary(item, startInfo, debug) {
    const initialState = await this.bridge.command("capture-state");
    const sourceAtStart = initialState.source;
    const duration = safeDuration(initialState);
    let lastMediaTime = safeCurrentTime(initialState);
    let pauseStartedAt = null;
    let ignoredNetworkTrackId = null;

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

      if (mediaState.paused && !mediaState.ended) {
        pauseStartedAt ??= now;
        if (now - pauseStartedAt > PAUSE_TIMEOUT_MS) {
          throw new Error(`Spotify paused unexpectedly for more than ${PAUSE_TIMEOUT_MS}ms during ${item.trackName}.`);
        }
      } else {
        pauseStartedAt = null;
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

      if (mediaState.ended || (mediaState.paused && isAtEnd(currentTime, duration))) {
        return {
          endMediaTime: Math.min(currentTime || lastMediaTime, duration),
          duration,
          reason: mediaState.ended ? "media-ended" : "paused-at-end"
        };
      }

      await delay(100);
    }
  }

  async finishPageCapture() {
    const capture = await this.bridge.command("capture-finish", {}, 60000);
    return this.normalizePageCapture(capture);
  }

  async finishAndBeginNextCapture() {
    const result = await this.bridge.command(
      "capture-finish-and-begin",
      { timeoutMs: START_TIMEOUT_MS },
      60000
    );
    return {
      ...result,
      finished: this.normalizePageCapture(result.finished)
    };
  }

  normalizePageCapture(capture) {
    const bytes = new Uint8Array(capture.bytesBuffer || new ArrayBuffer(0));
    return {
      bytes,
      byteLength: bytes.byteLength,
      sampleRate: capture.sampleRate,
      channelCount: capture.channelCount,
      startMediaTime: capture.startMediaTime
    };
  }

  async storeCapturedTrack(item, capture, captureEnd) {
    const captureWithHash = {
      ...capture,
      md5: md5Hex(capture.bytes)
    };
    const metadata = buildMetadata(item, captureWithHash, captureEnd);
    const pcmBase64 = bytesToBase64(capture.bytes);
    await writeTrackArtifact(item.trackId, pcmBase64, metadata);
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
    audioSampleRate: capture.sampleRate,
    audioChannelCount: capture.channelCount,
    audioChannelLayout: "interleaved",
    audioSampleFormat: "PCM_S16LE",
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

import { startPreciseCapture, captureTiming } from './preciseCapture.js';
import { discoverTrackRows } from "./trackDiscovery.js";
import { STORAGE_VERSION } from "./constants.js";
import {
  dispatchSyntheticDoubleClick,
  isSupportedRoute,
  pausePlaybackCleanly,
  resolveTrackRow
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
    this.tearingDown = false;
    this.stopReason = 'Capture run stopped by user.';
    this.singleTrack = false;
    this.captureProgress = null;
    this.lastProgressAt = -Infinity;
  }

  isActive() {
    return this.active;
  }

  async requestStop(reason = 'Capture run stopped by user.', { teardown = false } = {}) {
    this.tearingDown ||= teardown;
    this.stopRequested = true;
    this.stopReason = reason;
    this.clearCaptureProgress();
    pausePlaybackCleanly();
  }

  async run({ trackIds, trackSnapshot, collection = null, timingTrace = null } = {}) {
    if (this.tearingDown) throw new DOMException('Spotify page is closing.', 'AbortError');
    if (this.active) throw new Error('Capture is already running.');
    if (!Array.isArray(trackIds) || trackIds.length !== 1) throw new Error('Capture requires exactly one track.');
    this.collection = collection;
    this.active = true; this.stopRequested = false; this.singleTrack = true;
    this.stopReason = 'Capture run stopped by user.';
    this.clearCaptureProgress(); this.dispatchEvent(new Event('activechange'));
    const debug = { extension:'ktv420', startedAt:new Date().toISOString(), route:window.location.href,
      timingTrace:normalizeTimingTrace(timingTrace), events:[], phase:'preflight', recentMediaStates:[] };
    try {
      if (!isSupportedRoute()) throw new Error('Open a Spotify album or playlist.');
      const [item] = await this.preflightQueue(debug, trackIds, trackSnapshot);
      this.throwIfStopped();
      if (!item) throw new Error('The requested song was not found.');
      debug.trackId=item.trackId; debug.trackName=item.trackName;
      if (item.cached) { this.dispatchTrackStored(item.trackId,item.cachedMetadata); return; }
      await this.bridge.inject(); this.throwIfStopped();
      let row=resolveTrackRow(item);
      if (!row) {
        await discoverTrackRows({cancelled:()=>this.stopRequested || !!resolveTrackRow(item)});
        row=resolveTrackRow(item);
      }
      this.throwIfStopped();
      if (!row) throw new Error('Could not find the requested Spotify song.');
      dispatchSyntheticDoubleClick(row);
      const start=await this.beginAndAcceptItem(item,debug,{logFirstStartTiming:true});
      const end=await this.recordUntilBoundary(item,start,debug);
      this.markSaving(item.trackId); debug.phase='saving'; pausePlaybackCleanly();
      const capture=await this.finishPageCapture();
      // Once the natural end is verified, save it even if Stop is pressed during delivery.
      const metadata=await this.storeCapturedTrack(item,capture,end);
      this.dispatchTrackStored(item.trackId,metadata);
      this.dispatchCaptureComplete([item.trackId]);
    } catch(error) {
      pausePlaybackCleanly();
      // Reload/navigation closes the media bridge. It is cancellation, not a
      // recording defect, and must not overwrite the last genuine diagnostic.
      if (this.tearingDown) throw new DOMException('Spotify page is closing.', 'AbortError');
      const report={...debug,failedAt:new Date().toISOString(),error:serializeError(error),mediaSession:this.bridge.getSnapshot().mediaSession};
      try {window.sessionStorage.setItem('ktv420:last-capture-failure',JSON.stringify(report));}catch{/* retain console evidence */}
      console.warn(`[ktv420] Capture failed: ${report.error.message}`);
      console.debug('[ktv420] Capture diagnostic', report);
      throw error;
    } finally {
      this.clearCaptureProgress();
      await this.bridge.command('capture-abort').catch(()=>{});
      this.active=false;this.singleTrack=false;this.stopRequested=false;
      this.dispatchEvent(new Event('activechange'));
    }
  }

  async preflightQueue(_debug, trackIds, trackSnapshot) {
    const rows=normalizeTrackSnapshot(trackSnapshot).filter(row=>trackIds.includes(row.trackId));
    const cached=await readCachedTracks(trackIds);
    return rows.slice(0,1).map(row=>({...row,cached:cached.has(row.trackId),cachedMetadata:cached.get(row.trackId)}));
  }

  markSaving(trackId) {
    if (this.stopRequested) return;
    this.captureProgress = { trackId, fraction: .99, phase: 'saving' };
    this.dispatchEvent(new CustomEvent('captureprogress', { detail: this.captureProgress }));
  }

  dispatchTrackStored(trackId, metadata) {
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
      debug.phase = 'starting';
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
    debug.phase = 'recording';
    const initialState = await this.bridge.command("capture-state");
    const sourceAtStart = initialState.source;
    const duration = safeDuration(initialState);
    let lastMediaTime = safeCurrentTime(initialState);
    let ignoredNetworkTrackId = null;
    let backwardSample = null;
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
      const observation = { at: Date.now(), previousPosition: lastMediaTime, ...mediaState };
      const recent = debug.recentMediaStates ??= [];
      recent.push(observation);
      if (recent.length > 30) recent.shift();
      if (mediaState.invalid) {
        throw new Error(`Capture timing could not be verified: ${mediaState.invalidReason || 'The recording was interrupted.'} Nothing was saved.`);
      }
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

      // An emptied media element reports zero with no duration. That is loss of
      // the loaded recording source, not evidence of seeking back to the start.
      if (mediaState.readyState === 0 && mediaState.duration === null) {
        throw new Error(`Spotify unloaded the audio during ${item.trackName} at ${lastMediaTime.toFixed(1)}s. Nothing was saved; capture this song again.`);
      }

      if (currentTime + END_TOLERANCE_SECONDS < lastMediaTime) {
        if (isAtEnd(lastMediaTime, duration)) {
          return {
            endMediaTime: Math.min(lastMediaTime, duration),
            duration,
            reason: "time-reset-at-end"
          };
        }

        // A transient clock read is not a seek. Actual seeking invalidates the
        // page recorder immediately; confirm polling-only regressions once.
        if (!backwardSample) {
          backwardSample = observation;
          await delay(100);
          continue;
        }
        throw new Error(`Spotify moved backward during ${item.trackName} (${lastMediaTime.toFixed(3)}s → ${currentTime.toFixed(3)}s). Nothing was saved.`);
      }

      if (backwardSample) {
        debug.recoveredClockReadings = (debug.recoveredClockReadings || 0) + 1;
        debug.lastRecoveredClockReading = { from: backwardSample, to: observation };
        backwardSample = null;
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
    const metadata = { ...buildMetadata(item, captureWithHash, captureEnd), ...timing, collection: this.collection };
    await writeTrackArtifact(item.trackId, capture.bytes, metadata);
    return metadata;
  }

  throwIfStopped() {
    if (this.stopRequested) {
      throw new Error(this.stopReason);
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

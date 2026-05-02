import { useCallback, useEffect, useState } from "react";

import { downloadArtifactsToOpfs } from "./iframeArtifacts";

const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";
const PREPARE_JOB_MESSAGE = "ktv420:prepare-job";
const RUN_JOB_MESSAGE = "ktv420:run-job";
const PREPARE_JOB_RESULT_MESSAGE = "ktv420:prepare-job-result";
const RUN_JOB_RESULT_MESSAGE = "ktv420:run-job-result";

type IframeMessageType =
  | typeof CLOSE_OVERLAY_MESSAGE
  | typeof TOGGLE_RUN_MESSAGE
  | typeof PREPARE_JOB_MESSAGE
  | typeof RUN_JOB_MESSAGE;
type OpfsState = "missing" | "hydrated" | "broken";
type MetadataRecord = Record<string, unknown>;

type IframeTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
  opfsState: OpfsState;
  metadata: MetadataRecord | null;
  error?: string;
};

function getParentOrigin() {
  if (!document.referrer) {
    return "*";
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
}

function postParentMessage(type: IframeMessageType, payload: MetadataRecord = {}) {
  window.parent.postMessage({ source: IFRAME_MESSAGE_SOURCE, type, ...payload }, getParentOrigin());
}

export default function IframePage() {
  const [tracks, setTracks] = useState<IframeTrack[] | null>(null);
  const isReady = tracks !== null;

  useEffect(() => {
    const parentOrigin = getParentOrigin();
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return;
      }

      if (parentOrigin !== "*" && event.origin !== parentOrigin) {
        return;
      }

      const message = event.data;
      if (!message || message.source !== PARENT_MESSAGE_SOURCE) {
        return;
      }

      if (message.type === TRACKS_MESSAGE && Array.isArray(message.tracks)) {
        setTracks(
          message.tracks
            .map((track: unknown) => toIframeTrack(track))
            .filter((track: IframeTrack | null): track is IframeTrack => track !== null)
        );
        return;
      }

      if (message.type === PREPARE_JOB_RESULT_MESSAGE || message.type === RUN_JOB_RESULT_MESSAGE) {
        window.alert(formatActionResult(message));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const close = useCallback(() => {
    setTracks(null);
    postParentMessage(CLOSE_OVERLAY_MESSAGE);
  }, []);

  const toggleRun = useCallback(() => {
    if (!isReady) {
      return;
    }

    postParentMessage(TOGGLE_RUN_MESSAGE);
  }, [isReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "Enter" && isReady) {
        event.preventDefault();
        toggleRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isReady, toggleRun]);

  const prepareTrack = (track: IframeTrack) => {
    postParentMessage(PREPARE_JOB_MESSAGE, { trackId: track.trackId });
  };

  const runTrack = (track: IframeTrack) => {
    postParentMessage(RUN_JOB_MESSAGE, { trackId: track.trackId });
  };

  const downloadTrack = async (track: IframeTrack) => {
    try {
      const md5 = metadataMd5(track.metadata);

      if (!md5) {
        throw new Error("Track metadata does not include an md5.");
      }

      const result = await downloadArtifactsToOpfs(md5, track.metadata ?? {});
      window.alert(
        `Downloaded ${result.fileCount} file(s) to OPFS (${result.inputFileCount} input, ${result.outputFileCount} output). Deleted ${result.deletedCount} GCS object(s).`
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="iframe-page" aria-label="ktv420 iframe controls">
      <div className="iframe-actions">
        <button
          type="button"
          className="iframe-close-button"
          aria-label="Close"
          onClick={close}
        >
          ❌
        </button>
        <button
          type="button"
          className="iframe-logo-button"
          aria-label="Toggle ktv420 capture run"
          aria-disabled={!isReady}
          disabled={!isReady}
          onClick={toggleRun}
        >
          <img alt="" src="/favicon.svg" />
        </button>
      </div>
      {tracks && (
        <ol className="iframe-track-list" aria-label="Spotify page tracks">
          {tracks.map((track) => (
            <li
              key={`${track.trackId}-${track.rowIndex}`}
              className="iframe-track-row"
              title={metadataTooltip(track.metadata)}
            >
              <span className="iframe-track-state" aria-label={stateLabel(track.opfsState)}>
                {stateGlyph(track.opfsState)}
              </span>
              {track.trackArtworkSrc && (
                <img className="iframe-track-artwork" alt="" src={track.trackArtworkSrc} />
              )}
              <span className="iframe-track-copy">
                <span className="iframe-track-name">{track.trackName}</span>
                <span className="iframe-track-artist">{track.trackArtist}</span>
              </span>
              <span className="iframe-track-actions">
                <button
                  type="button"
                  disabled={track.opfsState !== "hydrated"}
                  onClick={() => prepareTrack(track)}
                >
                  Prepare
                </button>
                <button
                  type="button"
                  disabled={track.opfsState !== "hydrated"}
                  onClick={() => runTrack(track)}
                >
                  Run
                </button>
                <button
                  type="button"
                  disabled={!metadataMd5(track.metadata)}
                  onClick={() => {
                    void downloadTrack(track);
                  }}
                >
                  Download
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function toIframeTrack(value: unknown): IframeTrack | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const track = value as Record<string, unknown>;
  const metadata = isRecord(track.metadata) ? track.metadata : null;
  const trackId = readString(track.trackId) || readString(metadata?.trackId);
  const trackName = readString(track.trackName) || readString(metadata?.trackName);
  const trackArtist = readString(track.trackArtist) || readString(metadata?.trackArtist);
  const trackArtworkSrc = readString(track.trackArtworkSrc) || readString(metadata?.trackArtworkSrc);
  const rowIndex = typeof track.rowIndex === "number" ? track.rowIndex : null;
  const opfsState = isOpfsState(track.opfsState) ? track.opfsState : null;

  if (!trackId || !trackName || rowIndex === null || !opfsState) {
    return null;
  }

  return {
    trackId,
    trackName,
    trackArtist,
    trackArtworkSrc,
    rowIndex,
    opfsState,
    metadata,
    error: readString(track.error) || undefined
  };
}

function metadataTooltip(metadata: MetadataRecord | null) {
  return metadata ? JSON.stringify(metadata, null, 2) : undefined;
}

function formatActionResult(message: MetadataRecord) {
  if (message.ok === true) {
    return JSON.stringify(message.result ?? null, null, 2);
  }

  return readString(message.error) || "Action failed";
}

function metadataMd5(metadata: MetadataRecord | null) {
  const md5 = readString(metadata?.md5);
  return /^[a-fA-F0-9]{32}$/.test(md5) ? md5 : "";
}

function isRecord(value: unknown): value is MetadataRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isOpfsState(value: unknown): value is OpfsState {
  return value === "missing" || value === "hydrated" || value === "broken";
}

function stateGlyph(state: OpfsState) {
  if (state === "hydrated") {
    return "◪";
  }

  if (state === "broken") {
    return "☒";
  }

  return "□";
}

function stateLabel(state: OpfsState) {
  if (state === "hydrated") {
    return "Fully hydrated";
  }

  if (state === "broken") {
    return "Broken OPFS artifact";
  }

  return "Missing from OPFS";
}

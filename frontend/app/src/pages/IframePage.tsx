import { useEffect, useState } from "react";

const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";

type IframeMessageType = typeof CLOSE_OVERLAY_MESSAGE | typeof TOGGLE_RUN_MESSAGE;
type OpfsState = "missing" | "hydrated" | "broken";

type IframeTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
  opfsState: OpfsState;
  metadata: unknown;
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

function postParentMessage(type: IframeMessageType) {
  window.parent.postMessage({ source: IFRAME_MESSAGE_SOURCE, type }, getParentOrigin());
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
      if (
        !message ||
        message.source !== PARENT_MESSAGE_SOURCE ||
        message.type !== TRACKS_MESSAGE ||
        !Array.isArray(message.tracks)
      ) {
        return;
      }

      setTracks(message.tracks.filter(isIframeTrack));
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const close = () => {
    setTracks(null);
    postParentMessage(CLOSE_OVERLAY_MESSAGE);
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
          onClick={() => postParentMessage(TOGGLE_RUN_MESSAGE)}
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
              title={JSON.stringify(track, null, 2)}
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
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function isIframeTrack(value: unknown): value is IframeTrack {
  if (!value || typeof value !== "object") {
    return false;
  }

  const track = value as Partial<IframeTrack>;
  return Boolean(
    typeof track.trackId === "string" &&
      typeof track.trackName === "string" &&
      typeof track.trackArtist === "string" &&
      typeof track.trackArtworkSrc === "string" &&
      typeof track.rowIndex === "number" &&
      (track.opfsState === "missing" || track.opfsState === "hydrated" || track.opfsState === "broken")
  );
}

function stateGlyph(state: OpfsState) {
  if (state === "hydrated") {
    return "☑";
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

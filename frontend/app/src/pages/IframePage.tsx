const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";

type IframeMessageType = typeof CLOSE_OVERLAY_MESSAGE | typeof TOGGLE_RUN_MESSAGE;

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
  return (
    <main className="iframe-page" aria-label="ktv420 iframe controls">
      <div className="iframe-actions">
        <button
          type="button"
          className="iframe-close-button"
          onClick={() => postParentMessage(CLOSE_OVERLAY_MESSAGE)}
        >
          Close
        </button>
        <button
          type="button"
          className="iframe-logo-button"
          aria-label="Toggle ktv420 capture run"
          onClick={() => postParentMessage(TOGGLE_RUN_MESSAGE)}
        >
          <img alt="" src="/favicon.svg" />
        </button>
      </div>
    </main>
  );
}

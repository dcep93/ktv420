import { SELECTORS } from "./constants.js";
import { isSupportedRoute } from "./dom.js";

const BUTTON_ID = "ktv420-spotify-capture-button";
const STYLE_ID = "ktv420-spotify-capture-style";

export function mountButton({ isRunActive, onClick }) {
  injectStyle();

  const button = createButton(onClick);
  let scheduled = false;

  const place = () => {
    try {
      const logo = document.querySelector(SELECTORS.spotifyLogo);
      const parent = logo?.closest("a")?.parentElement;
      if (parent && button.parentElement !== parent) {
        parent.append(button);
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

  return {
    refresh: schedulePlace,
    disconnect: () => {
      observer.disconnect();
      window.clearInterval(intervalId);
      button.remove();
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
    onClick();
  });
  return button;
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
  `;
  document.documentElement.append(style);
}

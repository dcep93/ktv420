import { SELECTORS, SUPPORTED_ROUTE_RE } from "./constants.js";
import { compactWhitespace, looselyMatches } from "./text.js";

export function isSupportedRoute(pathname = window.location.pathname) {
  return SUPPORTED_ROUTE_RE.test(pathname);
}

export function findTracklistRoot() {
  return document.querySelector(SELECTORS.tracklistRoot);
}

export function extractTrackIdFromHref(href) {
  if (!href) {
    return null;
  }

  const relativeMatch = String(href).match(/^\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/);
  if (relativeMatch) {
    return relativeMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const parts = url.pathname.split("/").filter(Boolean);
    const trackIndex = parts.indexOf("track");
    const candidate = trackIndex >= 0 ? parts[trackIndex + 1] : null;
    return /^[A-Za-z0-9]{22}$/.test(candidate || "") ? candidate : null;
  } catch {
    const fallback = String(href).match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/);
    return fallback ? fallback[1] : null;
  }
}

export function collectTrackRows() {
  const root = findTracklistRoot();
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(SELECTORS.trackRow))
    .map((row, rowIndex) => {
      const anchor = row.querySelector(SELECTORS.trackAnchor);
      const trackId = extractTrackIdFromHref(anchor?.getAttribute("href") || anchor?.href);

      if (!trackId) {
        return null;
      }

      const trackName = compactWhitespace(anchor.textContent);
      const artists = Array.from(row.querySelectorAll(SELECTORS.artistAnchor))
        .map((artistAnchor) => compactWhitespace(artistAnchor.textContent))
        .filter(Boolean);
      const trackArtworkSrc = getLargestRowArtworkSrc(row);

      return {
        row,
        rowIndex,
        trackId,
        trackName,
        trackArtist: Array.from(new Set(artists)).join(", "),
        trackArtworkSrc
      };
    })
    .filter(Boolean);
}

function getLargestRowArtworkSrc(row) {
  const candidates = [];

  for (const image of row.querySelectorAll("img")) {
    if (image.currentSrc || image.src) {
      candidates.push({
        src: image.currentSrc || image.src,
        size:
          Math.max(image.naturalWidth || 0, image.width || 0) *
          Math.max(image.naturalHeight || 0, image.height || 0)
      });
    }

    for (const candidate of parseSrcset(image.getAttribute("srcset"))) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.size - a.size);
  return candidates[0]?.src || "";
}

function parseSrcset(srcset) {
  if (!srcset) {
    return [];
  }

  return srcset
    .split(",")
    .map((entry) => {
      const [src, descriptor = ""] = entry.trim().split(/\s+/, 2);
      const widthMatch = descriptor.match(/^(\d+)w$/);
      const densityMatch = descriptor.match(/^([\d.]+)x$/);
      const width = widthMatch ? Number(widthMatch[1]) : densityMatch ? Number(densityMatch[1]) : 0;
      return src ? { src, size: width * width } : null;
    })
    .filter(Boolean);
}

export function resolveTrackRow(track) {
  if (track?.row?.isConnected) {
    return track.row;
  }

  const rows = collectTrackRows();
  const byId = rows.find((row) => row.trackId === track.trackId);
  if (byId) {
    track.row = byId.row;
    track.rowIndex = byId.rowIndex;
    return byId.row;
  }

  const byIndex = rows[track.rowIndex];
  if (byIndex?.trackId === track.trackId) {
    track.row = byIndex.row;
    return byIndex.row;
  }

  return null;
}

export function scrollTracklistToStart() {
  const root = findTracklistRoot();
  const scroller = root ? findScrollableAncestor(root) : document.scrollingElement;

  if (!scroller) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  scroller.scrollTop = 0;
}

function findScrollableAncestor(element) {
  let current = element;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScroll =
      /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) &&
      current.scrollHeight > current.clientHeight + 1;

    if (canScroll) {
      return current;
    }

    current = current.parentElement;
  }

  return document.scrollingElement;
}

export function findVisibleEnabledButton(selector) {
  const button = document.querySelector(selector);
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return null;
  }

  const rect = button.getBoundingClientRect();
  const style = window.getComputedStyle(button);
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none";

  return visible ? button : null;
}

export function clickSkipForward() {
  const button = findVisibleEnabledButton(SELECTORS.skipForwardButton);
  if (!button) {
    throw new Error("Spotify skip-forward button is not visible and enabled.");
  }

  button.click();
}

export function pausePlaybackCleanly() {
  const button = findVisibleEnabledButton(SELECTORS.playPauseButton);
  if (!button) {
    return false;
  }

  const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""}`.toLowerCase();
  if (!label.includes("pause")) {
    return false;
  }

  button.click();
  return true;
}

export function dispatchSyntheticDoubleClick(element) {
  if (!(element instanceof Element)) {
    throw new Error("Cannot start playback because the track row is missing.");
  }

  element.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = element.getBoundingClientRect();
  const x = rect.left + Math.min(Math.max(rect.width * 0.3, 12), Math.max(rect.width - 12, 12));
  const y = rect.top + Math.max(rect.height / 2, 8);
  const eventBase = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1
  };

  for (const type of ["mousemove", "mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"]) {
    const detail = type === "dblclick" ? 2 : type === "click" ? 1 : 0;
    element.dispatchEvent(new MouseEvent(type, { ...eventBase, detail }));
  }
}

export function visibleTrackMatches(track, mediaMetadata) {
  if (!track || !mediaMetadata) {
    return false;
  }

  const nameMatches = looselyMatches(track.trackName, mediaMetadata.title);
  const artistMatches =
    !track.trackArtist ||
    !mediaMetadata.artist ||
    looselyMatches(track.trackArtist, mediaMetadata.artist);

  return nameMatches && artistMatches;
}

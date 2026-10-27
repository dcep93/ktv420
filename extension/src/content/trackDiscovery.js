import { collectTrackRows, findTracklistRoot } from './dom.js';

export function trackTotal() {
  const root = findTracklistRoot();
  // Spotify includes its column-header row in aria-rowcount.
  const count = Number(root?.getAttribute?.('aria-rowcount'));
  if (Number.isSafeInteger(count) && count > 1) return count - 1;
  const header = document.querySelector('[data-testid="entity-header"]')?.textContent || '';
  const match = header.match(/\b([\d,]+)\s+songs?\b/i);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function hasAllRows(tracks, total) {
  return Number.isSafeInteger(total) && total > 0 && tracks.length === total &&
    tracks.every((track, index) => track.rowIndex === index);
}

function scrollContainer() {
  for (let node = findTracklistRoot()?.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && node.clientHeight > 0 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

// The fallback must visit virtualized rows, not equate the currently rendered
// viewport with the playlist. It runs only after the user opens ktv420.
export async function discoverTrackRows({ initial = [], cancelled = () => false, onRows = () => {},
  read = collectTrackRows, total = trackTotal, container = scrollContainer,
  wait = () => new Promise(resolve => setTimeout(resolve, 150)), maxSteps = 120 } = {}) {
  const rows = new Map(initial.map(track => [track.rowIndex, track]));
  const snapshot = () => [...rows.values()].sort((a, b) => a.rowIndex - b.rowIndex);
  const collect = () => { for (const track of read()) rows.set(track.rowIndex, track); return snapshot(); };
  let tracks = collect();
  if (cancelled()) return { tracks, complete: false };
  if (hasAllRows(tracks, total())) return { tracks, complete: true };
  const scroller = container();
  if (!scroller) return { tracks, complete: false };
  const originalTop = scroller.scrollTop;
  let stableBottom = 0, previousSize = -1;
  try {
    scroller.scrollTop = 0;
    for (let step = 0; step < maxSteps && !cancelled(); step++) {
      await wait();
      if (cancelled()) break;
      tracks = collect();
      onRows(tracks);
      if (hasAllRows(tracks, total())) return { tracks, complete: true };
      const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop >= bottom - 1) {
        stableBottom = previousSize === rows.size ? stableBottom + 1 : 0;
        if (stableBottom >= 4) {
          // Without a published total, require a full sweep, stable bottom and
          // contiguous positions starting at the first track.
          return { tracks, complete: total() === null && hasAllRows(tracks, tracks.length) };
        }
      } else {
        stableBottom = 0;
        scroller.scrollTop = Math.min(bottom, scroller.scrollTop + Math.max(100, scroller.clientHeight * 0.7));
      }
      previousSize = rows.size;
    }
    return { tracks, complete: false };
  } finally {
    // Do not scroll a different Spotify route after navigation cancels a scan.
    if (!cancelled()) scroller.scrollTop = originalTop;
  }
}

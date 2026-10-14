export class CaptureRunProgress {
  constructor(emit) { this.emit = emit; this.tracks = new Map(); this.fraction = null; }
  begin(queue) {
    this.tracks = new Map(queue.map(item => [item.trackId, item.cached ? 1 : 0]));
    this.publish();
  }
  update(trackId, fraction) {
    if (!this.tracks.has(trackId) || !Number.isFinite(fraction)) return;
    this.tracks.set(trackId, Math.max(this.tracks.get(trackId), Math.min(1, Math.max(0, fraction))));
    this.publish();
  }
  publish() {
    this.fraction = this.tracks.size ? [...this.tracks.values()].reduce((sum, value) => sum + value, 0) / this.tracks.size : null;
    this.emit(this.fraction);
  }
  reset() { this.tracks.clear(); this.fraction = null; this.emit(null); }
}

export function createCaptureTitle(doc = document, Observer = MutationObserver) {
  let original = doc.title, applied = null, fraction = null, target = null;
  const render = () => {
    if (doc.title !== applied) original = doc.title;
    const title = fraction === null ? original : `[${Math.floor(fraction * 100)}%] ktv420 — ${original}`;
    applied = title;
    if (doc.title !== title) doc.title = title;
  };
  const observer = new Observer(render);
  return {
    set(value) {
      fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
      const nextTarget = doc.head;
      if (nextTarget && nextTarget !== target) {
        observer.disconnect(); target = nextTarget;
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      }
      render();
    },
    dispose() { fraction = null; render(); observer.disconnect(); },
  };
}

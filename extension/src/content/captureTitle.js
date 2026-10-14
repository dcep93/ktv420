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

export function createCaptureTitle(doc = document, Observer = MutationObserver, iconUrl = '') {
  let original = doc.title, applied = null, fraction = null, target = null, open = false, icon = null;
  const originalIcons = new Map();
  const renderIcon = () => {
    if (!iconUrl || !doc.head) return;
    if (open) {
      for (const link of doc.head.querySelectorAll('link[rel]')) {
        const rel = link.getAttribute('rel');
        if (link === icon || !/(^|\s)icon(\s|$)/i.test(rel || '')) continue;
        originalIcons.set(link, rel);
        link.removeAttribute('rel');
      }
      if (!icon) {
        icon = doc.createElement('link'); icon.rel = 'icon'; icon.type = 'image/svg+xml';
        icon.setAttribute('sizes', 'any'); icon.href = iconUrl;
      }
      if (!icon.isConnected) doc.head.append(icon);
    } else {
      icon?.remove();
      for (const [link, rel] of originalIcons) if (link.isConnected) link.setAttribute('rel', rel);
      originalIcons.clear();
    }
  };
  const render = () => {
    if (doc.title !== applied) original = doc.title;
    const prefix = fraction === null ? '' : `[${Math.floor(fraction * 100)}%] `;
    const title = open ? `${prefix}ktv420` : fraction === null ? original : `${prefix}ktv420 — ${original}`;
    applied = title;
    if (doc.title !== title) doc.title = title;
    renderIcon();
  };
  const observer = new Observer(render);
  const update = () => {
    if (doc.head && doc.head !== target) {
      observer.disconnect(); target = doc.head;
      observer.observe(target, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['rel', 'href', 'type', 'sizes'] });
    }
    render();
  };
  return {
    set(value) {
      fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
      update();
    },
    setOpen(value) { open = Boolean(value); update(); },
    dispose() { fraction = null; open = false; render(); observer.disconnect(); },
  };
}

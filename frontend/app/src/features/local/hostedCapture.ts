/** Playlist policy is hosted; the extension performs one verified capture at a time. */
export class HostedCaptureQueue {
  private generation = 0;
  active = false;
  total = 0;
  completed = 0;
  async run(ids: string[] | (() => string[]), saved: () => Set<string>, capture: (id:string) => Promise<void>, changed: () => void) {
    if (this.active) return false;
    const generation = ++this.generation;
    const readIds = () => [...new Set(typeof ids === 'function' ? ids() : ids)];
    const finished = new Set<string>();
    this.total = readIds().length; this.completed = 0;
    this.active = true; changed();
    try {
      while (generation === this.generation) {
        const current = readIds();
        this.total = new Set([...finished, ...current]).size;
        const id = current.find(candidate => !finished.has(candidate));
        if (id === undefined) break;
        if (!saved().has(id)) await capture(id);
        if (generation === this.generation) { finished.add(id); this.completed = finished.size; changed(); }
      }
      return generation === this.generation;
    } finally { if (generation === this.generation) { this.active = false; changed(); } }
  }
  cancel() { this.generation++; this.active = false; }
}

/** Playlist policy is hosted; the extension performs one verified capture at a time. */
export class HostedCaptureQueue {
  private generation = 0;
  active = false;
  total = 0;
  completed = 0;
  async run(ids: string[], saved: () => Set<string>, capture: (id:string) => Promise<void>, changed: () => void) {
    if (this.active) return false;
    const generation = ++this.generation;
    this.total = new Set(ids).size; this.completed = 0;
    this.active = true; changed();
    try {
      for (const id of new Set(ids)) {
        if (generation !== this.generation) return false;
        if (!saved().has(id)) await capture(id);
        if (generation === this.generation) { this.completed++; changed(); }
      }
      return generation === this.generation;
    } finally { if (generation === this.generation) { this.active = false; changed(); } }
  }
  cancel() { this.generation++; this.active = false; }
}

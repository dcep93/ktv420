export const MIN_TEMPO = .5;
export const MAX_TEMPO = 1.5;
export const MIN_PITCH = -12;
export const MAX_PITCH = 12;
export function validTempo(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_TEMPO && value <= MAX_TEMPO;
}
export function validPitch(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_PITCH && value <= MAX_PITCH;
}
/** Song time and performance time are different clocks. Never multiply the latter. */
export class SongClock {
  private anchor = 0;
  private offset = 0;
  private rate = 1;
  private active = false;
  private history: { when: number; position: number; rate: number }[] = [];
  private now: () => number;
  constructor(now: () => number) { this.now = now; }
  get position() { return this.offset + (this.active ? Math.max(0, this.now() - this.anchor) * this.rate : 0); }
  /** Recent presentation time, including rate changes inside the output delay. */
  positionAt(when: number) {
    if (!this.history.length) return this.offset;
    let segment = this.history[0];
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].when <= when) { segment = this.history[i]; break; }
    }
    return segment.position + Math.max(0, when - segment.when) * segment.rate;
  }
  private remember(when: number, rate: number) {
    // Keep one second plus the preceding segment, with a hard bound for automation.
    while (this.history.length > 1 && this.history[1].when < when - 1) this.history.shift();
    if (this.history.at(-1)?.when === when) this.history.pop();
    this.history.push({ when, position: this.offset, rate });
    if (this.history.length > 1024) this.history.shift();
  }
  endTime(duration: number) { return this.anchor + Math.max(0, duration - this.offset) / this.rate; }
  start(position: number, rate: number, when = this.now()) {
    this.offset = position; this.rate = rate; this.anchor = when; this.active = true;
    this.history = []; this.remember(when, rate);
  }
  changeRate(rate: number) {
    const now = this.now();
    this.offset += this.active ? Math.max(0, now - this.anchor) * this.rate : 0;
    this.anchor = Math.max(this.anchor, now); this.rate = rate;
    this.remember(this.anchor, this.active ? rate : 0);
  }
  pause() {
    const now = this.now();
    this.offset += this.active ? Math.max(0, now - this.anchor) * this.rate : 0;
    this.active = false; this.anchor = now;
    // Pausing during the lead-in cancels the future start as well.
    this.history = this.history.filter(segment => segment.when <= now);
    this.remember(now, 0); return this.offset;
  }
}

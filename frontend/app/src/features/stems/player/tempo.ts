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
  private now: () => number;
  constructor(now: () => number) { this.now = now; }
  get position() { return this.offset + (this.active ? Math.max(0, this.now() - this.anchor) * this.rate : 0); }
  start(position: number, rate: number, when = this.now()) { this.offset = position; this.rate = rate; this.anchor = when; this.active = true; }
  changeRate(rate: number) { this.offset = this.position; this.anchor = Math.max(this.anchor, this.now()); this.rate = rate; }
  pause() { this.offset = this.position; this.active = false; return this.offset; }
}

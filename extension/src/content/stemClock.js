// Remix time is independent of Spotify's native 1× media clock.
export class StemClock {
  constructor(now = () => Date.now() / 1000) { this.now = now; this.reset(); }
  reset() { this.active = false; this.rate = 1; this.offset = 0; this.anchor = this.now(); this.playing = false; }
  get position() { return this.offset + (this.playing ? Math.max(0, this.now() - this.anchor) * this.rate : 0); }
  setRate(rate, position, playing) {
    this.offset = this.active ? this.position : position;
    this.anchor = this.now(); this.playing = playing; this.rate = rate; this.active = true;
  }
  observe(position, playing, seeked = false) {
    if (!this.active) return;
    this.offset = seeked ? position : this.position;
    this.anchor = this.now(); this.playing = playing;
  }
}

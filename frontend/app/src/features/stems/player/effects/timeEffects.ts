const TAU = Math.PI * 2;
const WINDOW_SIZE = 4096;
const window = Float32Array.from({ length: WINDOW_SIZE + 1 }, (_, i) => .5 - .5 * Math.cos(TAU * i / WINDOW_SIZE));
function hann(phase: number) {
  const p = phase * WINDOW_SIZE, i = Math.min(WINDOW_SIZE - 1, Math.floor(p)), f = p - i;
  return window[i] + (window[i + 1] - window[i]) * f;
}

export class SampleDelay {
  data: Float32Array;
  index = 0;
  constructor(length: number) { this.data = new Float32Array(length); }
  read(samples: number) {
    let p = this.index - Math.max(1, Math.min(this.data.length - 2, samples));
    if (p < 0) p += this.data.length;
    const i = Math.floor(p), f = p - i;
    return this.data[i] * (1 - f) + this.data[(i + 1) % this.data.length] * f;
  }
  write(x: number) { this.data[this.index] = Math.abs(x) < 1e-20 ? 0 : x; if (++this.index === this.data.length) this.index = 0; }
  reset() { this.data.fill(0); this.index = 0; }
}

/** Windowed past phrases, not prediction: each grain reads backwards at 1×. */
export class ReverseGrains {
  private ages = new Float64Array([-1, -1, -1, -1]);
  private lengths = new Float64Array(4);
  private untilNext = 0;
  left = 0; right = 0;
  tick(lines: SampleDelay[], span: number) {
    // At most four overlapping grains even through abrupt timing changes.
    // Each grain keeps its own span; never move an audible read head mid-phrase.
    if (this.untilNext <= 0) {
      const slot = this.ages.findIndex(age => age < 0);
      if (slot >= 0) { this.ages[slot] = 0; this.lengths[slot] = Math.max(16, Math.round(span)); }
      this.untilNext = Math.max(8, Math.round(span / 2));
    }
    let left = 0, right = 0, weights = 0;
    for (let i = 0; i < this.ages.length; i++) {
      const age = this.ages[i]; if (age < 0) continue;
      const w = hann(age / this.lengths[i]);
      left += lines[0].read(1 + age * 2) * w;
      right += lines[1].read(1 + age * 2) * w;
      weights += w;
      if (++this.ages[i] >= this.lengths[i]) this.ages[i] = -1;
    }
    this.untilNext--;
    const scale = 1 / Math.max(1, weights);
    this.left = left * scale; this.right = right * scale;
  }
  reset() { this.ages.fill(-1); this.lengths.fill(0); this.untilNext = 0; this.left = this.right = 0; }
}

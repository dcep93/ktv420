/** Display-only periodicity estimate. Scratch is reused; no track identity is involved. */
export const pitchWindowSize = (rate: number) => Math.min(16384, Math.max(2048, 2 ** Math.ceil(Math.log2(rate * .085))));
export class PitchEstimator {
  private samples = new Float64Array(2048);
  private difference = new Float64Array(512);
  estimate(input: Float32Array, sampleRate: number): number | null {
    // Averaging before decimation reduces high-harmonic aliases. ~12 kHz is
    // sufficient for the register of melodic fundamentals, at bounded cost.
    const stride = Math.max(1, Math.floor(sampleRate / 12000));
    const rate = sampleRate / stride, count = Math.min(this.samples.length, Math.floor(input.length / stride));
    const maxLag = Math.min(this.difference.length - 2, Math.floor(rate / 35), Math.floor(count / 2));
    // Search short periods too, so high tones fall back instead of aliasing
    // to a lower octave inside the supported fundamental range.
    const minLag = 2;
    if (maxLag <= minLag) return null;
    let energy = 0, mean = 0;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let j = 0; j < stride; j++) sum += input[i * stride + j];
      const value = sum / stride;
      if (!Number.isFinite(value)) return null;
      this.samples[i] = value; mean += value; energy += value * value;
    }
    if (energy / count - (mean / count) ** 2 < 1e-8) return null;
    // Cumulative normalized squared difference (YIN). A fixed comparison
    // length prevents long lags winning merely because they compare fewer samples.
    const window = count - maxLag; let cumulative = 0;
    this.difference[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      let difference = 0;
      for (let i = 0; i < window; i++) {
        const delta = this.samples[i] - this.samples[i + lag]; difference += delta * delta;
      }
      cumulative += difference;
      this.difference[lag] = cumulative > 0 ? difference * lag / cumulative : 1;
    }
    for (let lag = minLag; lag < maxLag; lag++) {
      if (this.difference[lag] >= .15) continue;
      while (lag + 1 < maxLag && this.difference[lag + 1] < this.difference[lag]) lag++;
      if (lag === minLag || lag >= maxLag) return null;
      const left = this.difference[lag - 1], mid = this.difference[lag], right = this.difference[lag + 1];
      const curvature = left - 2 * mid + right;
      const offset = curvature > 1e-12 ? Math.max(-.5, Math.min(.5, (left - right) / (2 * curvature))) : 0;
      const hz = rate / (lag + offset);
      return hz >= 35 && hz <= 1600 ? hz : null;
    }
    return null;
  }
}

/** Don't mistake a brief attack/release for a sudden change of register. */
export class PitchContinuity {
  private hz: number | null = null;
  private uncertainAt = NaN;
  private candidate: number | null = null;
  private candidateAt = -Infinity;
  reset() { this.hz = null; this.gap(); }
  gap() { this.uncertainAt = NaN; this.candidate = null; this.candidateAt = -Infinity; }
  resolve(hz: number | null, time: number): number | null {
    if (hz === null) {
      if (!Number.isFinite(this.uncertainAt)) this.uncertainAt = time;
      return time - this.uncertainAt <= .18 ? this.hz : null;
    }
    this.uncertainAt = NaN;
    // Large one-frame errors occur at note boundaries. Require a second
    // agreeing observation for a leap; ordinary melodic steps respond immediately.
    if (this.hz !== null && Math.abs(Math.log2(hz / this.hz)) > .4) {
      if (this.candidate === null || Math.abs(Math.log2(hz / this.candidate)) > .1 || time - this.candidateAt > .12) {
        this.candidate = hz; this.candidateAt = time; return this.hz;
      }
    }
    this.hz = hz; this.candidate = null; return hz;
  }
}

/** Short level window keeps the longer pitch window from filling musical rests. */
export function pitchLevel(samples: Float32Array, sampleRate: number) {
  const start = Math.max(0, samples.length - Math.ceil(sampleRate * .02));
  let energy = 0;
  for (let i = start; i < samples.length; i++) energy += samples[i] ** 2;
  return Math.sqrt(energy / Math.max(1, samples.length - start));
}

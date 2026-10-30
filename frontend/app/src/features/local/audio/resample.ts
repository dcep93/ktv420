import { validateStereo, type StereoAudio } from './types.ts'

function reflect(index: number, length: number): number {
  if (length <= 1) return 0
  const period = 2 * (length - 1)
  const wrapped = ((index % period) + period) % period
  return wrapped < length ? wrapped : period - wrapped
}

function gcd(a: number, b: number): number {
  while (b) { const remainder = a % b; a = b; b = remainder }
  return a
}

/**
 * Zero-phase windowed-sinc resampling with 64 zero crossings and a Blackman window.
 * The cutoff follows the lower Nyquist rate, with a 5% transition guard band.
 * Output sample i is at exactly i/outputRate seconds; there is no filter delay.
 * Resampling necessarily changes values; equal-rate input bypasses the filter.
 */
export function resampleStereo(audio: StereoAudio, outputRate: number, outputFrames?: number, onProgress?: (fraction: number) => void): StereoAudio {
  validateStereo(audio)
  if (!Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 384000) throw new Error('Invalid resampling rate.')
  const frames = outputFrames ?? Math.round(audio.left.length * outputRate / audio.sampleRate)
  if (!Number.isSafeInteger(frames) || frames < 0) throw new Error('Invalid resampling length.')
  onProgress?.(0)
  if (audio.sampleRate === outputRate && frames === audio.left.length) {
    onProgress?.(1)
    return audio
  }
  if (!audio.left.length && frames) throw new Error('Cannot resample empty audio to nonempty audio.')
  const left = new Float32Array(frames), right = new Float32Array(frames)
  const ratio = audio.sampleRate / outputRate
  const cutoff = Math.min(1, 1 / ratio) * 0.95
  const radius = 64 / cutoff
  // Integer sample rates repeat the same fractional positions (147 for 48k→44.1k).
  // Reuse the exact filter, not a coarser approximation of it. Bound unusual-rate caches.
  const period = outputRate / gcd(audio.sampleRate, outputRate)
  const kernels = period <= 1024 && period * (2 * Math.ceil(radius) + 1) <= 262144
    ? new Map<number, { first: number; coefficients: Float64Array; weight: number }>() : null
  for (let i = 0; i < frames; i++) {
    const center = i * ratio
    let l = 0, r = 0, weight = 0
    const phase = i % period
    let kernel = kernels?.get(phase)
    if (kernels && !kernel) {
      const fraction = ((phase * audio.sampleRate) % outputRate) / outputRate
      const first = Math.ceil(fraction - radius), last = Math.floor(fraction + radius)
      const coefficients = new Float64Array(last - first + 1)
      let sum = 0
      for (let j = first; j <= last; j++) {
        const distance = j - fraction, x = Math.PI * cutoff * distance
        const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x
        const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius)
        const coefficient = cutoff * sinc * window
        coefficients[j - first] = coefficient; sum += coefficient
      }
      kernel = { first, coefficients, weight: sum }; kernels.set(phase, kernel)
    }
    if (kernel) {
      // Derive the integer position from the rates too, avoiding rounding below an
      // exact integer boundary in i * ratio when reusing a phase-zero kernel.
      const start = Math.floor(i * audio.sampleRate / outputRate) + kernel.first
      const interior = start >= 0 && start + kernel.coefficients.length <= audio.left.length
      for (let tap = 0; tap < kernel.coefficients.length; tap++) {
        const index = interior ? start + tap : reflect(start + tap, audio.left.length)
        const coefficient = kernel.coefficients[tap]
        l += audio.left[index] * coefficient; r += audio.right[index] * coefficient
      }
      weight = kernel.weight
    } else {
      for (let j = Math.ceil(center - radius); j <= Math.floor(center + radius); j++) {
        const distance = j - center
        const x = Math.PI * cutoff * distance
        const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x
        const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius)
        const coefficient = cutoff * sinc * window
        const index = j >= 0 && j < audio.left.length ? j : reflect(j, audio.left.length)
        l += audio.left[index] * coefficient
        r += audio.right[index] * coefficient
        weight += coefficient
      }
    }
    left[i] = l / weight; right[i] = r / weight
    // Worker messages can reach the UI while this synchronous calculation runs.
    // Report actual completed samples without callbacks in the filter tap loop.
    if ((i + 1) % 32768 === 0 && i + 1 < frames) onProgress?.((i + 1) / frames)
  }
  onProgress?.(1)
  return { left, right, sampleRate: outputRate }
}

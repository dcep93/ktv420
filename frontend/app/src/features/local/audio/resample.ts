import { validateStereo, type StereoAudio } from './types.ts'

function reflect(index: number, length: number): number {
  if (length <= 1) return 0
  const period = 2 * (length - 1)
  const wrapped = ((index % period) + period) % period
  return wrapped < length ? wrapped : period - wrapped
}

/**
 * Zero-phase windowed-sinc resampling with 64 zero crossings and a Blackman window.
 * The cutoff follows the lower Nyquist rate, with a 5% transition guard band.
 * Output sample i is at exactly i/outputRate seconds; there is no filter delay.
 * Resampling necessarily changes values; equal-rate input bypasses the filter.
 */
export function resampleStereo(audio: StereoAudio, outputRate: number, outputFrames?: number): StereoAudio {
  validateStereo(audio)
  if (!Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 384000) throw new Error('Invalid resampling rate.')
  const frames = outputFrames ?? Math.round(audio.left.length * outputRate / audio.sampleRate)
  if (!Number.isSafeInteger(frames) || frames < 0) throw new Error('Invalid resampling length.')
  if (audio.sampleRate === outputRate && frames === audio.left.length) return audio
  if (!audio.left.length && frames) throw new Error('Cannot resample empty audio to nonempty audio.')
  const left = new Float32Array(frames), right = new Float32Array(frames)
  const ratio = audio.sampleRate / outputRate
  const cutoff = Math.min(1, 1 / ratio) * 0.95
  const radius = 64 / cutoff
  for (let i = 0; i < frames; i++) {
    const center = i * ratio
    let l = 0, r = 0, weight = 0
    for (let j = Math.ceil(center - radius); j <= Math.floor(center + radius); j++) {
      const distance = j - center
      const x = Math.PI * cutoff * distance
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius)
      const coefficient = cutoff * sinc * window
      const index = reflect(j, audio.left.length)
      l += audio.left[index] * coefficient
      r += audio.right[index] * coefficient
      weight += coefficient
    }
    left[i] = l / weight; right[i] = r / weight
  }
  return { left, right, sampleRate: outputRate }
}

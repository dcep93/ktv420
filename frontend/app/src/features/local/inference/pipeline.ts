import { resampleStereo } from '../audio/resample.ts'
import { validateStereo, type StereoAudio } from '../audio/types.ts'
import { MODEL } from './model.ts'
import { STEM_NAMES, type ProgressCallback, type StemAudio } from './types.ts'
import { conditionAudio, restoreConditioning } from './conditioning.ts'

export type RunSegment = (channelFirst: Float32Array, frames: number) => Promise<Float32Array>

/** Positive triangle endpoints prevent losing sample zero and the final input sample. */
export function transitionWindow(frames: number): Float64Array {
  if (!Number.isSafeInteger(frames) || frames < 2) throw new Error('Invalid segment size.')
  const window = new Float64Array(frames)
  for (let i = 0; i < frames; i++) window[i] = Math.min(i + 1, frames - i) / Math.ceil(frames / 2)
  return window
}

/** Four-stem overlap-add; all indices are integer sample positions, never elapsed times. */
export async function separateWithRunner(
  input: StereoAudio,
  runSegment: RunSegment,
  onProgress: ProgressCallback = () => undefined,
  segmentFrames: number = MODEL.segmentFrames,
  useConditioning = true,
): Promise<StemAudio> {
  validateStereo(input)
  if (!input.left.length) throw new Error('The recording is empty.')
  const atModelRate = resampleStereo(input, MODEL.sampleRate, Math.max(1, Math.round(input.left.length * MODEL.sampleRate / input.sampleRate)), fraction => {
    onProgress({ phase: 'resampling', fraction, message: input.sampleRate === MODEL.sampleRate ? 'Preparing samples' : `Preparing audio: ${Math.floor(fraction * 100)}%` })
  })
  const conditioning = useConditioning ? conditionAudio(atModelRate) : { audio: atModelRate, mean: 0, scale: 1 }
  const audio = conditioning.audio
  // Finite source PCM can still overflow Float32 during resampling/conditioning.
  // Reject derived infinities before any tensor reaches the model.
  validateStereo(audio)
  const total = audio.left.length
  const stride = Math.floor(segmentFrames * 0.75)
  const window = transitionWindow(segmentFrames)
  const chunks = Math.ceil(total / stride)
  const accumulators = Array.from({ length: 8 }, () => new Float64Array(total))
  const weights = new Float64Array(total)
  const packed = new Float32Array(segmentFrames * 2)
  for (let chunk = 0; chunk < chunks; chunk++) {
    const start = chunk * stride
    const count = Math.min(segmentFrames, total - start)
    packed.fill(0)
    packed.set(audio.left.subarray(start, start + count))
    packed.set(audio.right.subarray(start, start + count), segmentFrames)
    const separated = await runSegment(packed, segmentFrames)
    if (!(separated instanceof Float32Array) || separated.length !== segmentFrames * 8) {
      throw new Error('The model returned an unexpected four-stem tensor.')
    }
    for (let channel = 0; channel < 8; channel++) {
      const source = channel * segmentFrames
      const destination = accumulators[channel]
      for (let i = 0; i < count; i++) {
        const sample = separated[source + i]
        if (!Number.isFinite(sample)) throw new Error('The model returned a non-finite sample.')
        destination[start + i] += sample * window[i]
      }
    }
    for (let i = 0; i < count; i++) weights[start + i] += window[i]
    onProgress({ phase: 'separating', fraction: (chunk + 1) / chunks, chunk: chunk + 1, totalChunks: chunks, message: `Separating segment ${chunk + 1} of ${chunks}` })
  }
  const output = {} as StemAudio
  for (let stem = 0; stem < STEM_NAMES.length; stem++) {
    onProgress({ phase: 'restoring', fraction: stem / STEM_NAMES.length, message: `Preparing ${STEM_NAMES[stem]}` })
    const left = new Float32Array(total), right = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      if (!(weights[i] > 0)) throw new Error('Missing overlap-add coverage.')
      left[i] = accumulators[stem * 2][i] / weights[i]
      right[i] = accumulators[stem * 2 + 1][i] / weights[i]
    }
    if (useConditioning) {
      restoreConditioning(left, conditioning.mean, conditioning.scale)
      restoreConditioning(right, conditioning.mean, conditioning.scale)
    }
    output[STEM_NAMES[stem]] = resampleStereo({ left, right, sampleRate: MODEL.sampleRate }, input.sampleRate, input.left.length, fraction => {
      onProgress({ phase: 'restoring', fraction: (stem + fraction) / STEM_NAMES.length, message: `Restoring ${STEM_NAMES[stem]}: ${Math.floor(fraction * 100)}%` })
    })
  }
  return output
}

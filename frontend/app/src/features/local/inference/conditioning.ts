import type { StereoAudio } from '../audio/types.ts'

/** Official Demucs CLI conditioning: mean and unbiased std of the mono reference. */
export function conditionAudio(audio: StereoAudio): { audio: StereoAudio; mean: number; scale: number } {
  const frames = audio.left.length
  let mean = 0, sumSquares = 0
  for (let i = 0; i < frames; i++) {
    const mono = Math.fround((audio.left[i] + audio.right[i]) / 2)
    const delta = mono - mean
    mean += delta / (i + 1)
    sumSquares += delta * (mono - mean)
  }
  const std = frames > 1 ? Math.sqrt(Math.max(0, sumSquares / (frames - 1))) : 0
  // Constant or exactly anti-phase stereo has zero mono variance. Avoid CLI's
  // division by zero while retaining any channel difference for the model.
  const scale = std > 0 ? std : 1
  const left = new Float32Array(frames), right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = (audio.left[i] - mean) / scale
    right[i] = (audio.right[i] - mean) / scale
  }
  return { audio: { left, right, sampleRate: audio.sampleRate }, mean, scale }
}

/** Undo model conditioning, matching Demucs' per-stem mean restoration. Never clamp. */
export function restoreConditioning(channel: Float32Array, mean: number, scale: number): void {
  for (let i = 0; i < channel.length; i++) channel[i] = channel[i] * scale + mean
}

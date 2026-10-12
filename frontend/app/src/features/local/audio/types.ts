export interface StereoAudio {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

export function validateStereo(audio: StereoAudio): void {
  if (!(audio.left instanceof Float32Array) || !(audio.right instanceof Float32Array)) {
    throw new Error('Audio channels must be Float32Array values.')
  }
  if (audio.left.length !== audio.right.length) throw new Error('Stereo channel lengths differ.')
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 384000) {
    throw new Error('Unsupported audio sample rate (expected 8,000–384,000 Hz).')
  }
  for (const channel of [audio.left, audio.right]) {
    for (const value of channel) {
      if (!Number.isFinite(value)) throw new Error('Audio contains a non-finite sample.')
    }
  }
}

import { validateStereo, type StereoAudio } from './types.ts'

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4))
}

/** Native-rate WAV decoding. Float32 words never pass through Web Audio or a PCM codec. */
export function decodeWav(buffer: ArrayBuffer): StereoAudio {
  const view = new DataView(buffer)
  if (buffer.byteLength < 12 || fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') {
    throw new Error('Expected a little-endian RIFF WAVE file.')
  }
  const end = view.getUint32(4, true) + 8
  if (end > buffer.byteLength || end < 12) throw new Error('Truncated WAV container.')
  let fmt = -1, fmtSize = 0, data = -1, dataSize = 0
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated WAV chunk header.')
    const id = fourCC(view, offset)
    const size = view.getUint32(offset + 4, true)
    const next = offset + 8 + size + (size % 2)
    if (next > end) throw new Error('Truncated WAV chunk.')
    if (id === 'fmt ') {
      if (fmt !== -1) throw new Error('Multiple WAV format chunks are unsupported.')
      fmt = offset + 8; fmtSize = size
    } else if (id === 'data') {
      if (data !== -1) throw new Error('Multiple WAV data chunks are unsupported.')
      data = offset + 8; dataSize = size
    }
    offset = next
  }
  if (fmt < 0 || fmtSize < 16 || data < 0) throw new Error('WAV needs format and audio data chunks.')
  let format = view.getUint16(fmt, true)
  const channelCount = view.getUint16(fmt + 2, true)
  const sampleRate = view.getUint32(fmt + 4, true)
  const byteRate = view.getUint32(fmt + 8, true)
  const blockAlign = view.getUint16(fmt + 12, true)
  const bits = view.getUint16(fmt + 14, true)
  if (format === 0xfffe) {
    if (fmtSize < 40 || view.getUint16(fmt + 16, true) < 22) throw new Error('Invalid extensible WAV format.')
    const validBits = view.getUint16(fmt + 18, true)
    const guidTail = [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]
    if (guidTail.some((value, i) => view.getUint8(fmt + 26 + i) !== value)) {
      throw new Error('Unsupported extensible WAV subformat.')
    }
    if (validBits !== bits) throw new Error('Packed extensible WAV valid-bit depths are unsupported.')
    format = view.getUint16(fmt + 24, true)
    const mask = view.getUint32(fmt + 20, true)
    if (mask !== 0 && mask !== (channelCount === 1 ? 4 : 3)) throw new Error('Unsupported WAV channel layout.')
  }
  if (channelCount !== 1 && channelCount !== 2) throw new Error('Select a mono or stereo WAV file.')
  if (!((format === 3 && bits === 32) || (format === 1 && [8, 16, 24, 32].includes(bits)))) {
    throw new Error('Supported WAV formats are Float32 and 8/16/24/32-bit PCM.')
  }
  const bytes = bits / 8
  if (blockAlign !== channelCount * bytes || byteRate !== sampleRate * blockAlign || dataSize % blockAlign) {
    throw new Error('Invalid WAV sample layout.')
  }
  const frames = dataSize / blockAlign
  const left = new Float32Array(frames), right = new Float32Array(frames)
  const words = [new Uint32Array(left.buffer), new Uint32Array(right.buffer)]
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const offset = data + i * blockAlign + c * bytes
      if (format === 3) {
        words[c][i] = view.getUint32(offset, true)
      } else {
        let sample: number
        if (bits === 8) sample = (view.getUint8(offset) - 128) / 128
        else if (bits === 16) sample = view.getInt16(offset, true) / 32768
        else if (bits === 24) {
          const raw = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
          sample = ((raw << 8) >> 8) / 8388608
        } else sample = view.getInt32(offset, true) / 2147483648
        ;(c === 0 ? left : right)[i] = sample
      }
    }
  }
  if (channelCount === 1) words[1].set(words[0])
  const audio = { left, right, sampleRate }
  validateStereo(audio)
  return audio
}

/** IEEE Float32 WAV with a fact chunk. No clipping, normalization or sample quantization. */
export function encodeFloat32Wav(audio: StereoAudio, channels: 1 | 2 = 2): ArrayBuffer {
  validateStereo(audio)
  if (channels !== 1 && channels !== 2) throw new Error('WAV export requires one or two channels.')
  const frames = audio.left.length
  const blockAlign = channels * 4
  const dataSize = frames * blockAlign
  if (dataSize > 0xffffffff - 50) throw new Error('Audio exceeds the RIFF WAV 4 GiB limit.')
  const buffer = new ArrayBuffer(58 + dataSize)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 18, true)
  view.setUint16(20, 3, true); view.setUint16(22, channels, true)
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true); view.setUint16(34, 32, true); view.setUint16(36, 0, true)
  write(38, 'fact'); view.setUint32(42, 4, true); view.setUint32(46, frames, true)
  write(50, 'data'); view.setUint32(54, dataSize, true)
  const left = new Uint32Array(audio.left.buffer, audio.left.byteOffset, frames)
  const right = new Uint32Array(audio.right.buffer, audio.right.byteOffset, frames)
  for (let i = 0; i < frames; i++) {
    if (channels === 1 && left[i] !== right[i]) throw new Error('Mono WAV export requires identical channels; downmixing would change samples.')
    view.setUint32(58 + i * blockAlign, left[i], true)
    if (channels === 2) view.setUint32(62 + i * blockAlign, right[i], true)
  }
  return buffer
}

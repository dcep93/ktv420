import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeWav, encodeFloat32Wav } from './wav.ts'

test('Float32 WAV round trip preserves every finite bit, including overrange, signed zero and subnormals', () => {
  const words = new Uint32Array(10009)
  words.set([0, 0x80000000, 1, 0x80000001, 0x7f7fffff, 0xff7fffff, 0x40400000, 0xc0a00000, 0x3eaaaaab])
  let seed = 0xdeadbeef
  for (let i = 9; i < words.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    words[i] = (seed & 0x7f800000) === 0x7f800000 ? seed ^ 0x00800000 : seed
  }
  // Nonzero typed-array offsets must also preserve the selected words.
  const left = new Float32Array(words.buffer).subarray(1)
  const right = new Float32Array(left).reverse()
  const encoded = encodeFloat32Wav({ left, right, sampleRate: 48000 })
  const decoded = decodeWav(encoded)
  assert.equal(decoded.sampleRate, 48000)
  assert.deepEqual(new Uint32Array(decoded.left.buffer), new Uint32Array(left.buffer, left.byteOffset, left.length))
  assert.deepEqual(new Uint32Array(decoded.right.buffer), new Uint32Array(right.buffer))
  assert.equal(new DataView(encoded).getUint16(20, true), 3)
  assert.equal(new DataView(encoded).getUint16(34, true), 32)
})

test('WAV rejects truncation, invalid block alignment, mismatched stereo and non-finite audio', () => {
  const audio = { left: new Float32Array([2]), right: new Float32Array([-3]), sampleRate: 44100 }
  const buffer = encodeFloat32Wav(audio)
  assert.throws(() => decodeWav(buffer.slice(0, -1)), /Truncated/)
  new DataView(buffer).setUint16(32, 7, true)
  assert.throws(() => decodeWav(buffer), /layout/)
  assert.throws(() => encodeFloat32Wav({ ...audio, right: new Float32Array(2) }), /lengths/)
  assert.throws(() => encodeFloat32Wav({ ...audio, left: new Float32Array([NaN]) }), /non-finite/)
})

test('Float32 mono export retains channel count and every source word without downmixing', () => {
  const words = new Uint32Array([0x80000000, 1, 0x40400000, 0xc0a00000])
  const left = new Float32Array(words.buffer)
  const right = new Float32Array(left)
  const encoded = encodeFloat32Wav({ left, right, sampleRate: 48000 }, 1)
  const header = new DataView(encoded)
  assert.equal(header.getUint16(22, true), 1)
  assert.equal(header.getUint16(32, true), 4)
  assert.equal(encoded.byteLength, 58 + 4 * words.length)
  assert.deepEqual(new Uint32Array(decodeWav(encoded).left.buffer), words)
  right[0] = 0
  assert.throws(() => encodeFloat32Wav({ left, right, sampleRate: 48000 }, 1), /identical/)
})

test('PCM16 mono WAV decodes at its native rate and duplicates channels without loss', () => {
  const samples = [-32768, -123, 0, 123, 32767]
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => [...value].forEach((v, i) => view.setUint8(offset + i, v.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 32000, true); view.setUint32(28, 64000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true))
  const decoded = decodeWav(buffer)
  assert.equal(decoded.sampleRate, 32000)
  assert.deepEqual([...decoded.left], samples.map(sample => sample / 32768))
  assert.deepEqual(decoded.left, decoded.right)
})

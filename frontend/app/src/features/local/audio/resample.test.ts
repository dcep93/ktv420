import test from 'node:test'
import assert from 'node:assert/strict'
import { resampleStereo } from './resample.ts'

test('equal sample rate bypasses conversion with no sample changes', () => {
  const source = { left: new Float32Array([2, -0, -3]), right: new Float32Array([-2, 1, 3]), sampleRate: 44100 }
  assert.equal(resampleStereo(source, 44100), source)
})

test('48k to 44.1k to 48k has exact requested length and no impulse timing shift', () => {
  const channel = new Float32Array(4801)
  channel[2400] = 2
  const input = { left: channel, right: new Float32Array(channel), sampleRate: 48000 }
  const converted = resampleStereo(input, 44100)
  assert.equal(converted.left.length, 4411)
  const result = resampleStereo(converted, 48000, input.left.length)
  assert.equal(result.left.length, input.left.length)
  const peak = result.left.reduce((best, value, index, arr) => Math.abs(value) > Math.abs(arr[best]) ? index : best, 0)
  assert.equal(peak, 2400)
  assert.deepEqual(result.left, result.right)
})

test('downsampling suppresses frequencies beyond the lower Nyquist and preserves DC overrange', () => {
  const n = 4800
  const source = new Float32Array(n).map((_, i) => Math.sin(2 * Math.PI * 22000 * i / 48000))
  const output = resampleStereo({ left: source, right: new Float32Array(n).fill(2), sampleRate: 48000 }, 44100)
  let energy = 0
  for (let i = 200; i < output.left.length - 200; i++) energy += output.left[i] ** 2
  assert.ok(Math.sqrt(energy / (output.left.length - 400)) < 0.001)
  assert.ok(output.right.every(value => Math.abs(value - 2) < 1e-6))
})


test('resampling reports sample-based intermediate progress without changing output', () => {
  const left = Float32Array.from({ length: 70000 }, (_, i) => Math.sin(i * 0.13))
  const input = { left, right: left.slice(), sampleRate: 44100 }
  const progress: number[] = []
  const actual = resampleStereo(input, 48000, 76000, fraction => progress.push(fraction))
  assert.deepEqual(progress, [0, 32768 / 76000, 65536 / 76000, 1])
  assert.deepEqual(actual, resampleStereo(input, 48000, 76000))
})

test('bypassed and empty resampling still report completion', () => {
  for (const frames of [0, 3]) {
    const progress: number[] = []
    const input = { left: new Float32Array(frames), right: new Float32Array(frames), sampleRate: 44100 }
    assert.equal(resampleStereo(input, 44100, undefined, fraction => progress.push(fraction)), input)
    assert.deepEqual(progress, [0, 1])
  }
})

/** Independent direct implementation of the original sinc filter, for numerical parity. */
function directReference(input: Float32Array, inputRate: number, outputRate: number, frames: number) {
  const ratio = inputRate / outputRate, cutoff = Math.min(1, 1 / ratio) * .95, radius = 64 / cutoff
  const output = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    const center = i * ratio
    let value = 0, weight = 0
    for (let j = Math.ceil(center - radius); j <= Math.floor(center + radius); j++) {
      const distance = j - center, x = Math.PI * cutoff * distance
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x
      const coefficient = cutoff * sinc * (.42 + .5 * Math.cos(Math.PI * distance / radius) + .08 * Math.cos(2 * Math.PI * distance / radius))
      const period = 2 * (input.length - 1), wrapped = ((j % period) + period) % period
      const index = input.length <= 1 ? 0 : wrapped < input.length ? wrapped : period - wrapped
      value += input[index] * coefficient; weight += coefficient
    }
    output[i] = value / weight
  }
  return output
}

test('cached phases preserve the original filter across stereo, boundaries, tails and uncommon rates', () => {
  for (const [inputRate, outputRate, length] of [[48000, 44100, 12000], [44100, 48000, 12000], [96000, 44100, 3000], [48001, 44100, 500], [384000, 8000, 101], [48000, 44100, 1]]) {
    const left = Float32Array.from({ length }, (_, i) => Math.sin(i * .71) * 2 + Math.cos(i * .13))
    const right = Float32Array.from({ length }, (_, i) => i % 31 === 0 ? -2 : .125)
    const frames = Math.round(length * outputRate / inputRate) + 3
    const result = resampleStereo({ left, right, sampleRate: inputRate }, outputRate, frames)
    for (const [source, actual] of [[left, result.left], [right, result.right]]) {
      const reference = directReference(source, inputRate, outputRate, frames)
      assert.equal(actual.length, frames)
      for (let i = 0; i < frames; i++) assert.ok(Math.abs(actual[i] - reference[i]) < 1e-6, `${inputRate}→${outputRate}, sample ${i}`)
    }
  }
})

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

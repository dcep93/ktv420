import test from 'node:test'
import assert from 'node:assert/strict'
import { fft, ifft, stft, istft, reflectPad } from './fft.ts'
import { prepareModelInput, reconstructStems, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES } from './splitModel.ts'

test('FFT complex sign, scaling and inverse agree with a known sinusoid', () => {
  const n = 64, bin = 5
  const input = Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * bin * i / n))
  const real = new Float32Array(n), imag = new Float32Array(n)
  fft(real, imag, input, n)
  assert.ok(Math.abs(imag[bin] + n / 2) < 1e-5)
  assert.ok(Math.abs(real[bin]) < 1e-5)
  const restored = new Float32Array(n), restoredImag = new Float32Array(n)
  ifft(restored, restoredImag, real, imag, n)
  for (let i = 0; i < n; i++) assert.ok(Math.abs(restored[i] - input[i]) < 1e-6)
})

test('normalized Hann STFT and ISTFT preserve amplitude and sample position', () => {
  const signal = new Float32Array(8192)
  signal[4095] = 2.5; signal[4096] = -1.75
  const padded = reflectPad(signal, 2048, 2048)
  const spectrum = stft(padded, 4096, 1024)
  const output = istft(spectrum.real, spectrum.imag, spectrum.numFrames, spectrum.numBins, 4096, 1024, padded.length)
  for (let i = 0; i < signal.length; i++) assert.ok(Math.abs(output[i + 2048] - signal[i]) < 1e-6, `sample ${i}`)
})

test('Demucs complex channel layout and split branch reconstruction retain stereo order and alignment', () => {
  const n = 343980, left = new Float32Array(n), right = new Float32Array(n)
  left[100000] = 2; right[120001] = -3
  const input = prepareModelInput(left, right)
  assert.equal(input.magSpec.length, 4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES)
  assert.equal(input.waveform[100000], 2)
  assert.equal(input.waveform[n + 120001], -3)
  const frequency = new Float32Array(input.magSpec.length * 4)
  // Assign a different multiplier to each output stem to expose ordering errors.
  for (let stem = 0; stem < 4; stem++) {
    for (let i = 0; i < input.magSpec.length; i++) frequency[stem * input.magSpec.length + i] = input.magSpec[i] * (stem + 1)
  }
  const result = reconstructStems(new Float32Array(n * 8), frequency)
  for (let stem = 0; stem < 4; stem++) {
    // Demucs deliberately drops Nyquist, so an impulse loses at most ~1/N amplitude.
    assert.ok(Math.abs(result[(stem * 2) * n + 100000] - 2 * (stem + 1)) < 0.003)
    assert.ok(Math.abs(result[(stem * 2 + 1) * n + 120001] + 3 * (stem + 1)) < 0.004)
    assert.ok(Math.abs(result[(stem * 2 + 1) * n + 100000]) < 1e-6)
    assert.ok(Math.abs(result[(stem * 2) * n + 120001]) < 1e-6)
  }
})

test('spectral overflow from finite Float32 input is rejected before tensor construction', () => {
  const largest = new Float32Array(new Uint32Array([0x7f7fffff]).buffer)[0]
  const left = new Float32Array(343980).fill(largest)
  const right = new Float32Array(343980).fill(-largest)
  assert.throws(() => prepareModelInput(left, right), /finite Float32 range/)
})

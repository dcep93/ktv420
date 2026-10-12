/*
Adapted from timcsy/demucs-web, commit 617385fbf5883b04a2e6f474be63ed4d93f4e44c.
https://github.com/timcsy/demucs-web

MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * Fast FFT/iFFT implementation using Cooley-Tukey radix-2 algorithm
 */

type Twiddles = { real: Float32Array; imag: Float32Array };
const fftTwiddles = new Map<number, Twiddles>();
const ifftTwiddles = new Map<number, Twiddles>();
const hannWindows = new Map<number, Float32Array>();

function getFFTTwiddles(n: number): Twiddles {
  if (fftTwiddles.has(n)) return fftTwiddles.get(n)!;
  const real = new Float32Array(n / 2);
  const imag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const angle = -2 * Math.PI * k / n;
    real[k] = Math.cos(angle);
    imag[k] = Math.sin(angle);
  }
  const twiddles = { real, imag };
  fftTwiddles.set(n, twiddles);
  return twiddles;
}

function getIFFTTwiddles(n: number): Twiddles {
  if (ifftTwiddles.has(n)) return ifftTwiddles.get(n)!;
  const real = new Float32Array(n / 2);
  const imag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const angle = 2 * Math.PI * k / n;
    real[k] = Math.cos(angle);
    imag[k] = Math.sin(angle);
  }
  const twiddles = { real, imag };
  ifftTwiddles.set(n, twiddles);
  return twiddles;
}

export function getHannWindow(size: number): Float32Array {
  if (hannWindows.has(size)) return hannWindows.get(size)!;
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / size));
  }
  hannWindows.set(size, window);
  return window;
}

function bitReverse(n: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (n & 1);
    n >>= 1;
  }
  return result;
}

export function fft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, n: number): void {
  const bits = Math.log2(n) | 0;
  const twiddles = getFFTTwiddles(n);

  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    realOut[i] = realIn[j];
    imagOut[i] = 0;
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * step;
        const tReal = twiddles.real[k];
        const tImag = twiddles.imag[k];
        const idx1 = i + j;
        const idx2 = i + j + halfSize;
        const eReal = realOut[idx1];
        const eImag = imagOut[idx1];
        const oReal = realOut[idx2] * tReal - imagOut[idx2] * tImag;
        const oImag = realOut[idx2] * tImag + imagOut[idx2] * tReal;
        realOut[idx1] = eReal + oReal;
        imagOut[idx1] = eImag + oImag;
        realOut[idx2] = eReal - oReal;
        imagOut[idx2] = eImag - oImag;
      }
    }
  }
}

export function ifft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, imagIn: Float32Array, n: number): void {
  const bits = Math.log2(n) | 0;
  const twiddles = getIFFTTwiddles(n);

  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    realOut[i] = realIn[j];
    imagOut[i] = imagIn[j];
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * step;
        const tReal = twiddles.real[k];
        const tImag = twiddles.imag[k];
        const idx1 = i + j;
        const idx2 = i + j + halfSize;
        const eReal = realOut[idx1];
        const eImag = imagOut[idx1];
        const oReal = realOut[idx2] * tReal - imagOut[idx2] * tImag;
        const oImag = realOut[idx2] * tImag + imagOut[idx2] * tReal;
        realOut[idx1] = eReal + oReal;
        imagOut[idx1] = eImag + oImag;
        realOut[idx2] = eReal - oReal;
        imagOut[idx2] = eImag - oImag;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    realOut[i] /= n;
    imagOut[i] /= n;
  }
}

export function stft(signal: Float32Array, fftSize: number, hopSize: number) {
  const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2 + 1;
  const window = getHannWindow(fftSize);
  const scale = 1.0 / Math.sqrt(fftSize);

  const specReal = new Float32Array(numFrames * numBins);
  const specImag = new Float32Array(numFrames * numBins);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);
  const windowedFrame = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      windowedFrame[i] = signal[start + i] * window[i];
    }
    fft(frameReal, frameImag, windowedFrame, fftSize);
    const outOffset = frame * numBins;
    for (let k = 0; k < numBins; k++) {
      specReal[outOffset + k] = frameReal[k] * scale;
      specImag[outOffset + k] = frameImag[k] * scale;
    }
  }

  return { real: specReal, imag: specImag, numFrames, numBins };
}

export function istft(specReal: Float32Array, specImag: Float32Array, numFrames: number, numBins: number, fftSize: number, hopSize: number, length: number): Float32Array {
  const outputLength = length || (numFrames - 1) * hopSize + fftSize;
  const output = new Float32Array(outputLength);
  const windowSum = new Float32Array(outputLength);
  const window = getHannWindow(fftSize);
  const scale = Math.sqrt(fftSize);

  const fullReal = new Float32Array(fftSize);
  const fullImag = new Float32Array(fftSize);
  const outReal = new Float32Array(fftSize);
  const outImag = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    fullReal.fill(0);
    fullImag.fill(0);

    for (let k = 0; k < numBins; k++) {
      fullReal[k] = specReal[frame * numBins + k];
      fullImag[k] = specImag[frame * numBins + k];
    }

    for (let k = 1; k < numBins - 1; k++) {
      fullReal[fftSize - k] = fullReal[k];
      fullImag[fftSize - k] = -fullImag[k];
    }

    ifft(outReal, outImag, fullReal, fullImag, fftSize);

    const start = frame * hopSize;
    for (let i = 0; i < fftSize && start + i < outputLength; i++) {
      output[start + i] += outReal[i] * window[i] * scale;
      windowSum[start + i] += window[i] * window[i];
    }
  }

  for (let i = 0; i < outputLength; i++) {
    if (windowSum[i] > 1e-8) {
      output[i] /= windowSum[i];
    }
  }

  return output;
}

export function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array {
  const length = signal.length;
  const output = new Float32Array(padLeft + length + padRight);

  for (let i = 0; i < padLeft; i++) {
    const srcIdx = Math.min(padLeft - i, length - 1);
    output[i] = signal[srcIdx];
  }

  output.set(signal, padLeft);

  for (let i = 0; i < padRight; i++) {
    const srcIdx = Math.max(0, length - 2 - i);
    output[padLeft + length + i] = signal[srcIdx];
  }

  return output;
}

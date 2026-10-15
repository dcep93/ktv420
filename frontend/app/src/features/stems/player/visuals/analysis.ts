// Arrays belong to their analyser, so switching views does not allocate each frame.
const byteBuffers = new WeakMap<AnalyserNode, Map<number, Uint8Array<ArrayBuffer>>>();
const floatBuffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
export function analysisBytes(analyser: AnalyserNode, length: number) {
  let buffers = byteBuffers.get(analyser);
  if (!buffers) { buffers = new Map(); byteBuffers.set(analyser, buffers); }
  let buffer = buffers.get(length);
  if (!buffer) { buffer = new Uint8Array(length); buffers.set(length, buffer); }
  return buffer;
}
export function waveform(analyser: AnalyserNode) {
  let buffer = floatBuffers.get(analyser);
  if (!buffer || buffer.length !== analyser.fftSize) { buffer = new Float32Array(analyser.fftSize); floatBuffers.set(analyser, buffer); }
  analyser.getFloatTimeDomainData(buffer);
  return buffer;
}
export function signalRms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}
export function frequencyBin(hz: number, sampleRate: number, fftSize: number) {
  return Math.max(0, Math.min(fftSize / 2 - 1, Math.round(hz * fftSize / sampleRate)));
}
export function bandLevel(analyser: AnalyserNode, low: number, high: number) {
  const data = analysisBytes(analyser, analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const start = frequencyBin(low, analyser.context.sampleRate, analyser.fftSize);
  const end = Math.max(start, frequencyBin(high, analyser.context.sampleRate, analyser.fftSize));
  let sum = 0;
  for (let i = start; i <= end; i++) sum += data[i] / 255;
  return sum / (end - start + 1);
}
export function stereoPoint(left: number, right: number) {
  return { side: (left - right) / 2, mid: (left + right) / 2 };
}
export type StereoTap = { left: AnalyserNode; right: AnalyserNode; dispose: () => void };
export function createStereoTap(source: AudioNode): StereoTap {
  const context = source.context, splitter = context.createChannelSplitter(2);
  const left = context.createAnalyser(), right = context.createAnalyser();
  left.fftSize = right.fftSize = 1024;
  // A silent destination keeps both analysis branches live without doubling audio.
  const sink = context.createGain(); sink.gain.value = 0;
  source.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
  left.connect(sink); right.connect(sink); sink.connect(context.destination);
  return { left, right, dispose() { source.disconnect(splitter); splitter.disconnect(); left.disconnect(); right.disconnect(); sink.disconnect(); } };
}

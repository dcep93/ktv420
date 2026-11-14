export const MASTER_CEILING = 10 ** (-1 / 20);
const MASTER_KNEE = .75;
const CURVE_DOMAIN = 32;

/** Chromium's native compressor look-ahead, rounded to whole audio frames. */
export function masterLatencyFrames(sampleRate: number) { return Math.floor(sampleRate * .006); }

export function softCeiling(sample: number) {
  const magnitude = Math.abs(sample);
  return magnitude <= MASTER_KNEE ? sample : Math.sign(sample) * (MASTER_KNEE +
    (MASTER_CEILING - MASTER_KNEE) * Math.tanh((magnitude - MASTER_KNEE) / (MASTER_CEILING - MASTER_KNEE)));
}

// WaveShaper copies its assigned curve; keep this template private and immutable.
const ceilingCurve = Float32Array.from({ length: 65537 }, (_, i) => softCeiling((2 * i / 65536 - 1) * CURVE_DOMAIN));

/** Shared stereo mix protection. Listening volume belongs after this graph. */
export function createMasterAudio(context: BaseAudioContext) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = .003;
  compressor.release.value = .15;
  const scale = context.createGain();
  scale.gain.value = 1 / CURVE_DOMAIN;
  const ceiling = context.createWaveShaper();
  ceiling.curve = ceilingCurve;
  ceiling.oversample = 'none';
  compressor.connect(scale); scale.connect(ceiling);
  return {
    input: compressor,
    output: ceiling,
    latencySeconds: masterLatencyFrames(context.sampleRate) / context.sampleRate,
    dispose() { compressor.disconnect(); scale.disconnect(); ceiling.disconnect(); },
  };
}

export type MasterAudio = ReturnType<typeof createMasterAudio>;

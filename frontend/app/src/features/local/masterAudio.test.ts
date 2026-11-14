import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_CEILING, masterLatencyFrames, softCeiling } from '../stems/player/masterAudio';
import { getLogarithmicVolumeGain } from '../stems/player/mixerGain';

test('master safety ceiling preserves quiet samples and bounds finite extremes symmetrically', () => {
  for (const sample of [0, .01, .5, .75]) assert.equal(softCeiling(sample), sample);
  for (const sample of [.01, .5, .75, .751, 1, 2, 32, 1e10, Number.MAX_VALUE]) {
    assert.equal(softCeiling(-sample), -softCeiling(sample));
    assert.ok(softCeiling(sample) <= MASTER_CEILING);
    assert.ok(softCeiling(sample) >= Math.min(sample, .75));
  }
  assert.equal(softCeiling(Number.MAX_VALUE), MASTER_CEILING);
});

test('master delay uses whole native compressor frames at the context sample rate', () => {
  assert.equal(masterLatencyFrames(44100), 264);
  assert.equal(masterLatencyFrames(48000), 288);
  assert.equal(masterLatencyFrames(96000), 576);
});

test('existing faders retain silence, unity and +16 dB boost', () => {
  assert.equal(getLogarithmicVolumeGain(0), 0);
  assert.equal(getLogarithmicVolumeGain(1), 1);
  assert.equal(getLogarithmicVolumeGain(2), 10 ** (16 / 20));
});

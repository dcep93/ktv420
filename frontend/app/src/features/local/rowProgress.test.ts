import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSeparationFraction } from './rowProgress.ts';

test('row progress remains monotonic through model loading, separation, resampling, and MP3 saving', () => {
  let value: number | null = null;
  for (const [phase, fraction, expected] of [
    ['download', 1, null], ['loading', 0, null], ['resampling', 0, null],
    ['separating', 0.5, 0.45], ['separating', 1, 0.9], ['resampling', 0, 0.9],
    ['complete', 1, 0.9], ['encoding', 0, 0.9], ['encoding', 1, 0.99],
  ] as const) {
    value = nextSeparationFraction(value, { phase, fraction, message: '' });
    assert.equal(value, expected);
  }
});

test('invalid, regressing, and out-of-range updates cannot corrupt row progress', () => {
  assert.equal(nextSeparationFraction(0.8, { phase: 'separating', fraction: 0.2, message: '' }), 0.8);
  assert.equal(nextSeparationFraction(null, { phase: 'separating', fraction: NaN, message: '' }), null);
  assert.equal(nextSeparationFraction(null, { phase: 'encoding', fraction: 2, message: '' }), 0.99);
});

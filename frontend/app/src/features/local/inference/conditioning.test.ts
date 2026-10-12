import test from 'node:test'
import assert from 'node:assert/strict'
import { conditionAudio, restoreConditioning } from './conditioning.ts'

test('global mono mean and unbiased std match known values and restore overrange audio', () => {
  const original = new Float32Array([-4, 0, 4])
  const conditioned = conditionAudio({ left: original, right: new Float32Array([0, 4, 8]), sampleRate: 44100 })
  assert.equal(conditioned.mean, 2)
  assert.equal(conditioned.scale, 4)
  assert.deepEqual([...conditioned.audio.left], [-1.5, -0.5, 0.5])
  restoreConditioning(conditioned.audio.left, conditioned.mean, conditioned.scale)
  restoreConditioning(conditioned.audio.right, conditioned.mean, conditioned.scale)
  assert.deepEqual(conditioned.audio.left, original)
  assert.deepEqual([...conditioned.audio.right], [0, 4, 8])
})

test('zero-variance mono and anti-phase stereo retain finite channel differences', () => {
  for (const left of [new Float32Array(1), new Float32Array([2, -3, 4])]) {
    const result = conditionAudio({ left, right: left.map(value => -value), sampleRate: 44100 })
    assert.equal(result.mean, 0)
    assert.equal(result.scale, 1)
    assert.deepEqual(result.audio.left, left)
  }
})

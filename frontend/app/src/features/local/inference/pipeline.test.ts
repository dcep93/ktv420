import test from 'node:test'
import assert from 'node:assert/strict'
import { separateWithRunner } from './pipeline.ts'
import { STEM_NAMES, type SeparationProgress } from './types.ts'

test('segment substeps are reported without claiming unfinished audio as completed', async () => {
  const progress: SeparationProgress[] = []
  const audio = { left: new Float32Array(25), right: new Float32Array(25), sampleRate: 44100 }
  await separateWithRunner(audio, async (_packed, frames, reportStep) => {
    reportStep('Preparing frequency input')
    reportStep('Running GPU model')
    reportStep('Reconstructing stems')
    return new Float32Array(frames * 8)
  }, value => progress.push(value), 32, false)
  const running = progress.filter(p => p.message.startsWith('Running GPU'))
  assert.deepEqual(running.map(p => p.message), ['Running GPU model · segment 1 of 2', 'Running GPU model · segment 2 of 2'])
  assert.deepEqual(running.map(p => p.fraction), [0, .5])
})

test('overlap-add preserves endpoints, seams, stereo order and arbitrary tail length', async () => {
  for (const length of [1, 7, 23, 24, 31, 32, 33, 48, 65, 97]) {
    const left = Float32Array.from({ length }, (_, i) => i % 3 === 0 ? 2.125 : -0.375)
    const right = Float32Array.from({ length }, (_, i) => i % 5 === 0 ? -3.25 : 0.625)
    const progress: number[] = []
    let calls = 0
    const output = await separateWithRunner({ left, right, sampleRate: 44100 }, async (packed, frames) => {
      calls++
      const stems = new Float32Array(frames * 8)
      for (let stem = 0; stem < 4; stem++) {
        for (let i = 0; i < packed.length; i++) stems[stem * packed.length + i] = packed[i] * (stem + 1)
      }
      return stems
    }, value => { if (value.phase === 'separating') progress.push(value.fraction) }, 32, false)
    assert.equal(calls, Math.ceil(length / 24))
    assert.equal(progress.at(-1), 1)
    STEM_NAMES.forEach((name, stem) => {
      assert.equal(output[name].left.length, length)
      assert.equal(output[name].sampleRate, 44100)
      for (let i = 0; i < length; i++) {
        assert.equal(output[name].left[i], left[i] * (stem + 1), `${name} left sample ${i}`)
        assert.equal(output[name].right[i], right[i] * (stem + 1), `${name} right sample ${i}`)
      }
    })
  }
})

test('pipeline validates model output and unequal channel lengths', async () => {
  const audio = { left: new Float32Array(1), right: new Float32Array(1), sampleRate: 44100 }
  await assert.rejects(separateWithRunner(audio, async () => new Float32Array(1), undefined, 32), /unexpected/)
  await assert.rejects(separateWithRunner(audio, async () => new Float32Array(256).fill(NaN), undefined, 32), /non-finite/)
  await assert.rejects(separateWithRunner({ ...audio, right: new Float32Array(2) }, async () => new Float32Array(256), undefined, 32), /lengths/)
})

test('finite input whose conditioning overflows is rejected before calling the model', async () => {
  const tiny = new Float32Array(new Uint32Array([2]).buffer)[0]
  let calls = 0
  const audio = { left: new Float32Array([1, -1, 0]), right: new Float32Array([-1, 1, tiny]), sampleRate: 44100 }
  await assert.rejects(separateWithRunner(audio, async () => {
    calls++
    return new Float32Array(256)
  }, undefined, 32), /non-finite/)
  assert.equal(calls, 0)
})


test('preparation and restoration report intermediate progress across all four stems', async () => {
  const progress: SeparationProgress[] = []
  const input = { left: new Float32Array(72000), right: new Float32Array(72000), sampleRate: 48000 }
  const output = await separateWithRunner(input, async (_packed, frames) => new Float32Array(frames * 8), value => progress.push(value), 32768, false)
  const preparing = progress.filter(value => value.phase === 'resampling')
  assert.ok(preparing.some(value => value.fraction > 0 && value.fraction < 1))
  assert.equal(preparing.at(-1)?.fraction, 1)
  const restoring = progress.filter(value => value.phase === 'restoring')
  assert.equal(restoring[0].fraction, 0)
  assert.equal(restoring.at(-1)?.fraction, 1)
  for (let i = 1; i < restoring.length; i++) assert.ok(restoring[i].fraction >= restoring[i - 1].fraction)
  STEM_NAMES.forEach((name, stem) => {
    assert.ok(restoring.some(value => value.fraction > stem / 4 && value.fraction < (stem + 1) / 4 && value.message.includes(name)))
    assert.equal(output[name].sampleRate, input.sampleRate)
    assert.equal(output[name].left.length, input.left.length)
  })
})

test('bounded overlap storage is sample-identical to full Float64 accumulation, including boundaries', async () => {
  const { transitionWindow } = await import('./pipeline');
  const segment = 32, stride = 24, total = 103, window = transitionWindow(segment);
  const reference = Array.from({ length: 8 }, () => new Float64Array(total)), weights = new Float64Array(total);
  let chunk = 0;
  const result = await separateWithRunner({ left: new Float32Array(total), right: new Float32Array(total), sampleRate: 44100 }, async () => {
    const values = Float32Array.from({ length: segment * 8 }, (_, i) => Math.sin(i * .37 + chunk * 2.3) * (chunk + 1));
    const start = chunk * stride, count = Math.min(segment, total - start);
    for (let c = 0; c < 8; c++) for (let i = 0; i < count; i++) reference[c][start + i] += values[c * segment + i] * window[i];
    for (let i = 0; i < count; i++) weights[start + i] += window[i];
    chunk++; return values;
  }, () => {}, segment, false);
  for (const [stem, name] of ['drums', 'bass', 'other', 'vocals'].entries()) {
    const output = result[name as keyof typeof result];
    for (let i = 0; i < total; i++) {
      assert.equal(output.left[i], Math.fround(reference[stem * 2][i] / weights[i]));
      assert.equal(output.right[i], Math.fround(reference[stem * 2 + 1][i] / weights[i]));
    }
  }
});

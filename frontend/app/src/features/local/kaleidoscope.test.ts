import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKaleidoscopeMotion, updateKaleidoscopeMotion, kaleidoscopePose } from '../stems/player/visuals/kaleidoscopeMotion';

function run(fps: number, energy = .5) {
  const state = createKaleidoscopeMotion();
  for (let i = 0; i <= fps * 10; i++) updateKaleidoscopeMotion(state, i / fps, true, true, energy, .4);
  return state;
}
test('music moves the pattern at a moderate bounded pace; silence stays still', () => {
  const silent = createKaleidoscopeMotion(), initial = kaleidoscopePose(silent);
  for (let i = 0; i < 600; i++) updateKaleidoscopeMotion(silent, i / 60, true, true, 0, 0);
  assert.deepEqual(kaleidoscopePose(silent), initial);
  const quiet = run(60, .1), loud = run(60, .8);
  assert.ok(loud.phase > quiet.phase * 2);
  assert.ok(loud.rotation > .5 && loud.rotation < 1.2, 'less than 70 degrees over ten seconds');
  assert.notEqual(kaleidoscopePose(loud).x, initial.x);
});
test('pause and mute freeze the pose even if analyser data or time changes', () => {
  const state = run(60), before = kaleidoscopePose(state);
  for (let i = 0; i < 100; i++) updateKaleidoscopeMotion(state, 10, false, true, 0, 0);
  assert.deepEqual(kaleidoscopePose(state), before);
  for (let i = 0; i < 100; i++) updateKaleidoscopeMotion(state, 10 + i / 60, true, false, 1, 1);
  assert.deepEqual(kaleidoscopePose(state), before);
});
test('motion pacing is consistent across 30, 60 and 120 fps', () => {
  const reference = run(120);
  for (const fps of [30, 60]) {
    const state = run(fps);
    assert.ok(Math.abs(state.phase - reference.phase) < .02);
    assert.ok(Math.abs(state.rotation - reference.rotation) < .005);
  }
});
test('attacks gently pulse the zoom; seeks never integrate a giant movement', () => {
  const state = run(60, .1), before = kaleidoscopePose(state);
  for (let i = 1; i <= 6; i++) updateKaleidoscopeMotion(state, 10 + i / 60, true, true, .9, .8);
  const pulse = kaleidoscopePose(state);
  assert.ok(pulse.scale > before.scale + .015); assert.ok(pulse.scale < .9);
  updateKaleidoscopeMotion(state, 900, true, true, .9, .8);
  assert.deepEqual(kaleidoscopePose(state), pulse);
  updateKaleidoscopeMotion(state, 0, true, true, 0, 0); assert.deepEqual(kaleidoscopePose(state), pulse);
  updateKaleidoscopeMotion(state, NaN, true, true, NaN, NaN); assert.deepEqual(kaleidoscopePose(state), pulse);
});

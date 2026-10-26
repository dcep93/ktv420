import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflectedPosition } from '../stems/player/visuals/sceneMotion';
import { spherePoint, mirrorLight } from '../stems/player/visuals/discoBall';
import { createArtState } from '../stems/player/visuals/artSceneState';
import { drawBeach } from '../stems/player/visuals/beach';
import { drawAquarium } from '../stems/player/visuals/aquarium';
import { drawRockShow } from '../stems/player/visuals/rockShow';
import { drawDiscoBall } from '../stems/player/visuals/discoBall';
import { drawInk } from '../stems/player/visuals/inkTank';

test('tank motion covers both walls and reflects continuously without wrapping', () => {
  assert.equal(reflectedPosition(0, 30, 0), 0);
  assert.equal(reflectedPosition(30, 30, 0), 1);
  assert.equal(reflectedPosition(60, 30, 0), 0);
  for (const t of [0, 30, 60, 90, 30000]) {
    assert.ok(Math.abs(reflectedPosition(t - .001, 30, 0) - reflectedPosition(t + .001, 30, 0)) < .001);
  }
  for (let i = 0; i < 10000; i++) {
    const x = reflectedPosition(i * .13, 37, .73); assert.ok(x >= 0 && x <= 1);
    assert.ok(Math.abs(x - reflectedPosition(i * .13 + 1 / 60, 37, .73)) <= 1 / 60 / 37 + 1e-12);
  }
});

test('mirror tiles project onto a sphere with a lit upper-left and shaded lower-right', () => {
  for (let row = 0; row <= 18; row++) for (let col = 0; col < 36; col++) {
    const p = spherePoint(-Math.PI / 2 + row / 18 * Math.PI, col / 36 * Math.PI * 2);
    assert.ok(Math.abs(p.x ** 2 + p.y ** 2 + p.z ** 2 - 1) < 1e-12);
    assert.ok(p.x ** 2 + p.y ** 2 <= 1 + 1e-12);
  }
  assert.ok(mirrorLight(-.6, -.6, .529) > mirrorLight(.6, .6, .529) * 4);
});

test('live scenes freeze exactly at a paused transport time and remain finite after a long seek', () => {
  for (const draw of [drawInk, drawBeach, drawAquarium, drawRockShow, drawDiscoBall]) {
    const state = createArtState(); Object.keys(state.audio.levels).forEach(role => { state.audio.levels[role as keyof typeof state.audio.levels] = .6; });
    state.time = 17.125;
    let ops: unknown[][] = [];
    const c = new Proxy({}, {
      set(_target, key, value) { ops.push([String(key), typeof value === "object" ? "gradient" : value]); return true; },
      get(_target, key) { return (...args: unknown[]) => {
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg));
        ops.push([String(key), ...args]);
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return { addColorStop(...values: unknown[]) { ops.push(values); } };
      }; },
    }) as CanvasRenderingContext2D;
    draw({ c, w: 1200, h: 800, state }); const first = ops;
    ops = []; draw({ c, w: 1200, h: 800, state });
    assert.deepEqual(ops, first, draw.name);
    state.time = 7200; ops = []; draw({ c, w: 1200, h: 800, state }); assert.ok(ops.length < 7500, draw.name);
  }
});

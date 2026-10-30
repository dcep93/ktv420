import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeMonitor } from '../src/content/volume.js';
function fixture(initial) {
  let dom = initial, running = false, time = 0, scheduled;
  const writes = [], gains = [], errors = [];
  const monitor = createVolumeMonitor({
    read: () => dom, write: value => { writes.push(value); dom = value; },
    apply: async value => { gains.push(value); }, active: () => running,
    onError: error => errors.push(error), now: () => time,
    schedule: fn => { scheduled = fn; return 1; }, unschedule: () => { scheduled = undefined; },
  });
  return { monitor, writes, gains, errors,
    dom: value => { dom = value; }, running: value => { running = value; },
    advance: () => { time += 250; }, flush: () => { const fn = scheduled; scheduled = undefined; fn?.(); },
  };
}
test('opening inherits Spotify including zero and never writes a default', () => {
  for (const initial of [0, 0.37, 1, null]) {
    const f = fixture(initial);
    assert.equal(f.monitor.value(), initial);
    f.monitor.sync();
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.gains, []);
  }
});
test('later Spotify changes replace a previous overlay volume', async () => {
  const f = fixture(.4);
  f.monitor.set(.7); f.flush(); f.advance();
  f.dom(.2);
  assert.equal(f.monitor.value(), .2);
  f.running(true); await f.monitor.sync(true);
  assert.deepEqual(f.gains, [.2]);
  f.dom(0); await f.monitor.sync();
  assert.equal(f.monitor.value(), 0);
  assert.deepEqual(f.gains, [.2, 0]);
});
test('dragging updates immediately and coalesces DOM and capture monitor writes', async () => {
  const f = fixture(.4); f.running(true);
  for (const value of [.45, .5, .55, .6]) f.monitor.set(value);
  assert.equal(f.monitor.value(), .6);
  assert.deepEqual(f.writes, []);
  f.flush();
  assert.deepEqual(f.writes, [.6]);
  assert.deepEqual(f.gains, [.6]);
  f.dom(.4); // React may briefly expose the pre-input value.
  assert.equal(f.monitor.value(), .6);
  f.advance(); f.dom(.6); await f.monitor.sync();
  assert.deepEqual(f.gains, [.6]);
});
test('idle slider changes do not enable audio monitoring', async () => {
  const f = fixture(.3); f.monitor.set(.5); f.flush();
  assert.deepEqual(f.writes, [.5]); assert.deepEqual(f.gains, []);
  f.running(true); await f.monitor.sync();
  f.running(false); await f.monitor.sync();
  f.running(true); await f.monitor.sync();
  assert.deepEqual(f.gains, [.5, .5]);
});
test('unavailable Spotify controls do not turn into full volume', () => {
  const f = fixture(null); f.running(true); f.monitor.sync();
  assert.equal(f.monitor.value(), null); assert.deepEqual(f.gains, []);
  f.dom(.23); assert.equal(f.monitor.value(), .23);
});
test('page teardown cancels a queued slider write', () => {
  const f = fixture(.3); f.monitor.set(.9); f.monitor.dispose(); f.flush();
  assert.deepEqual(f.writes, []);
});

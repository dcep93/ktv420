import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSpacePlayback } from './spacePlayback';
function key(type = 'keydown', values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code: 'Space', key: ' ', repeat: false, ...values });
  return event;
}
test('Space consumes press, repeat, and release; toggles once per press', () => {
  const target = new EventTarget(); let toggles = 0, nativeActions = 0;
  bindSpacePlayback(target, () => toggles++);
  target.addEventListener('keydown', () => nativeActions++);
  target.addEventListener('keyup', () => nativeActions++);
  for (const event of [key(), key('keydown', { repeat: true }), key('keyup')]) {
    target.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  }
  assert.equal(toggles, 1); assert.equal(nativeActions, 0);
  target.dispatchEvent(key()); assert.equal(toggles, 2);
});
test('Space is reserved even with modifiers or previously prevented default', () => {
  const target = new EventTarget(); let toggles = 0;
  bindSpacePlayback(target, () => toggles++);
  const event = key('keydown', { ctrlKey: true }); event.preventDefault();
  target.dispatchEvent(event); assert.equal(toggles, 1);
});
test('Other keys work, key fallback works, and cleanup removes both handlers', () => {
  const target = new EventTarget(); let toggles = 0;
  const remove = bindSpacePlayback(target, () => toggles++);
  const arrow = key('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
  target.dispatchEvent(arrow); assert.equal(arrow.defaultPrevented, false); assert.equal(toggles, 0);
  target.dispatchEvent(key('keydown', { code: '' })); assert.equal(toggles, 1);
  remove();
  for (const event of [key(), key('keyup')]) {
    target.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  }
  assert.equal(toggles, 1);
});

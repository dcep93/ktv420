import test from 'node:test';
import assert from 'node:assert/strict';
import { StemClock } from '../src/content/stemClock.js';

test('remix clock advances independently, preserves rate changes and follows pause/seek', () => {
  let now = 0;
  const clock = new StemClock(() => now);
  clock.setRate(1.5, 10, true);
  now = 2; clock.observe(12, true);
  assert.equal(clock.position, 13);
  clock.setRate(.5, 12, true);
  now = 4; assert.equal(clock.position, 14);
  clock.observe(14, false);
  now = 10; assert.equal(clock.position, 14);
  clock.observe(20, false, true);
  assert.equal(clock.position, 20);
  clock.observe(20, true);
  now = 12; assert.equal(clock.position, 21);
  clock.setRate(1, 22, true);
  now = 14; assert.equal(clock.position, 23, 'returning to 1x does not jump to Spotify');
  clock.reset(); assert.equal(clock.active, false); assert.equal(clock.rate, 1);
});

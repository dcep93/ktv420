import test from 'node:test';
import assert from 'node:assert/strict';
import { INFERENCE_SILENCE_MS, watchInference } from './watchdog';

test('a silent worker times out once, even when no progress ever arrives', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const errors: Error[] = [];
  const watch = watchInference(error => errors.push(error));
  t.mock.timers.tick(INFERENCE_SILENCE_MS - 1);
  assert.equal(errors.length, 0);
  t.mock.timers.tick(1);
  assert.match(errors[0].message, /Starting the separation worker.*recording is saved/);
  watch.progress({ phase: 'separating', fraction: .2, message: 'Late reply' });
  t.mock.timers.tick(INFERENCE_SILENCE_MS);
  assert.equal(errors.length, 1);
});

test('stalled segment reports its stage; duplicate status does not keep it alive', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const errors: Error[] = [];
  const watch = watchInference(error => errors.push(error));
  const progress = { phase: 'separating' as const, fraction: 5 / 37, message: 'Separating segment 6 of 37' };
  watch.progress(progress);
  t.mock.timers.tick(INFERENCE_SILENCE_MS - 1);
  watch.progress(progress);
  t.mock.timers.tick(1);
  assert.match(errors[0].message, /Separating segment 6 of 37/);
});

test('genuine progress renews the timeout and slow completed segments extend it', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const errors: Error[] = [];
  const watch = watchInference(error => errors.push(error));
  watch.progress({ phase: 'separating', fraction: 0, message: 'Separating segment 1 of 37' });
  t.mock.timers.tick(90_000);
  watch.progress({ phase: 'separating', fraction: 1 / 37, message: 'Completed segment 1 of 37' });
  watch.progress({ phase: 'separating', fraction: 1 / 37, message: 'Separating segment 2 of 37' });
  t.mock.timers.tick(8 * 90_000 - 1);
  assert.equal(errors.length, 0);
  t.mock.timers.tick(1);
  assert.equal(errors.length, 1);
});

test('completion or cancellation stops the timer permanently', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const watch = watchInference(() => assert.fail('Stopped inference must not time out'));
  watch.stop();
  watch.progress({ phase: 'separating', fraction: .1, message: 'Late progress' });
  t.mock.timers.tick(INFERENCE_SILENCE_MS * 2);
});

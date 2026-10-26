import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingCaptureSaves, acknowledgeCaptureSaves } from './captureProgress.ts';

test('saving stays visible across transfer completion and next-song capture until storage catches up', () => {
 let pending = pendingCaptureSaves([], {trackId:'first',fraction:.99,phase:'saving'}, '');
 pending = acknowledgeCaptureSaves(pending, []); // an older library poll completes
 pending = pendingCaptureSaves(pending, null, ''); // extension finishes transfer
 pending = pendingCaptureSaves(pending, {trackId:'second',fraction:.01}, '');
 assert.deepEqual(pending, ['first']);
 pending = pendingCaptureSaves(pending, {trackId:'second',fraction:.99,phase:'saving'}, '');
 pending = acknowledgeCaptureSaves(pending, ['first']);
 assert.deepEqual(pending, ['second']);
 pending = acknowledgeCaptureSaves(pending, ['first','second']);
 assert.deepEqual(pending, []);
 assert.deepEqual(acknowledgeCaptureSaves(pending, []), [], 'later deletion must not resurrect a saving badge');
});
test('failed saves clear their pending indicators instead of showing Saving forever', () => {
 const pending = pendingCaptureSaves([], {trackId:'first',fraction:.99,phase:'saving'}, '');
 assert.deepEqual(pendingCaptureSaves(pending, null, 'Disk full'), []);
});

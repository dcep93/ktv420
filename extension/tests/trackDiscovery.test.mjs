import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverTrackRows, hasAllRows, trackTotal } from '../src/content/trackDiscovery.js';

const rows = Array.from({ length: 45 }, (_, rowIndex) => ({ rowIndex, trackId: `id${rowIndex}` }));
test('virtualized discovery loads all 45 rows, not just the initial 36, and restores scrolling', async () => {
  const scroller = { scrollTop: 200, clientHeight: 400, scrollHeight: 1800 };
  const updates = [];
  const result = await discoverTrackRows({ initial: rows.slice(0, 36), total: () => 45,
    container: () => scroller, wait: async () => {}, onRows: value => updates.push(value.length),
    read: () => rows.slice(Math.floor(scroller.scrollTop / 40), Math.floor(scroller.scrollTop / 40) + 10) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.tracks, rows);
  assert.ok(updates.includes(45));
  assert.equal(scroller.scrollTop, 200);
});
test('known missing rows cannot be declared complete at the bottom or after the scan budget', async () => {
  for (const maxSteps of [2, 20]) {
    const result = await discoverTrackRows({ total: () => 45, read: () => rows.slice(0, 36),
      container: () => ({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }), wait: async () => {}, maxSteps });
    assert.equal(result.complete, false);
    assert.equal(result.tracks.length, 36);
  }
  assert.equal(hasAllRows([...rows.slice(0, 44), { rowIndex: 45 }], 45), false);
});
test('unknown totals require a stable full sweep; repeated songs retain their positions', async () => {
  const repeated = [{ rowIndex: 0, trackId: 'same' }, { rowIndex: 1, trackId: 'same' }];
  let waits = 0;
  const result = await discoverTrackRows({ total: () => null, read: () => repeated,
    container: () => ({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }), wait: async () => { waits++; } });
  assert.equal(result.complete, true); assert.deepEqual(result.tracks, repeated); assert.ok(waits >= 5);
});
test('route cancellation stops discovery without scrolling the new route', async () => {
  let cancelled = false;
  const scroller = { scrollTop: 200, clientHeight: 400, scrollHeight: 1800 };
  const result = await discoverTrackRows({ total: () => 45, read: () => rows.slice(0, 10),
    container: () => scroller, cancelled: () => cancelled,
    wait: async () => { cancelled = true; scroller.scrollTop = 75; } });
  assert.equal(result.complete, false); assert.equal(scroller.scrollTop, 75);
});


test('track totals exclude the grid header and fall back to the collection header', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let count = '46', header = 'Public Playlist • 45 songs, about 3 hr';
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => selector.includes('entity-header') ? { textContent: header } : { getAttribute: () => count },
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  assert.equal(trackTotal(), 45);
  count = null; assert.equal(trackTotal(), 45);
  header = 'Album'; assert.equal(trackTotal(), null);
});

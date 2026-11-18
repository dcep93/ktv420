import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverTrackRows, revealTrackRow, hasAllRows, trackTotal } from '../src/content/trackDiscovery.js';

const rows = Array.from({ length: 45 }, (_, rowIndex) => ({ rowIndex, trackId: `id${rowIndex}` }));
test('capture jumps directly to a known virtualized row and still requires its exact identity', async () => {
  const scroller = { scrollTop: 0, clientHeight: 400, scrollHeight: 4000, getBoundingClientRect: () => ({ top: 100 }) };
  let waits = 0;
  const read = () => Array.from({ length: 10 }, (_, i) => {
    const rowIndex = Math.floor(scroller.scrollTop / 40) + i;
    return { rowIndex, trackId: `id${rowIndex}`, row: { getBoundingClientRect: () => ({ top: 100 + rowIndex * 40 - scroller.scrollTop, height: 40 }) } };
  });
  const options = { read, container: () => scroller, wait: async () => { waits++; } };
  assert.ok(await revealTrackRow({ trackId: 'id75', rowIndex: 75 }, options));
  assert.equal(waits, 1, 'one targeted scroll rather than scanning the first 75 songs');
  assert.equal(await revealTrackRow({ trackId: 'different', rowIndex: 75 }, options), null);
  assert.equal(await revealTrackRow({ trackId: 'id75', rowIndex: 75 }, { ...options, cancelled: () => true }), null);
});
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


test('track totals prefer the song count and fall back to the grid without its column header', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let count = '46', header = 'Public Playlist • 45 songs, about 3 hr';
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => selector.includes('entity-header') ? { textContent: header } : { getAttribute: () => count },
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  assert.equal(trackTotal(), 45);
  header = 'Playlist'; assert.equal(trackTotal(), 45);
  header = 'Playlist • 1,234 songs'; assert.equal(trackTotal(), 1234);
  header = 'Album • 1 song'; assert.equal(trackTotal(), 1);
  header = 'Public Playlist • 45 songs, about 3 hr';
  count = null; assert.equal(trackTotal(), 45);
  header = 'Album'; assert.equal(trackTotal(), null);
});

test('a 16-song, two-disc album completes without searching for its disc headings as songs', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => selector.includes('entity-header')
      ? { textContent: 'Album • 2026 • 16 songs, 55 min 47 sec' }
      : { getAttribute: () => '19' },
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  const album = rows.slice(0, 16);
  assert.equal(trackTotal(), 16);
  const result = await discoverTrackRows({ read: () => album,
    container: () => { assert.fail('A complete album should not need a scroll sweep'); } });
  assert.equal(result.complete, true);
  assert.deepEqual(result.tracks, album);
  const partial = await discoverTrackRows({ read: () => album.slice(0, 12), container: () => null });
  assert.equal(partial.complete, false, 'The first disc alone must not count as the complete album');
});

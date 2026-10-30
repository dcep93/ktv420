import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaptureOrchestrator } from '../src/content/orchestrator.js';

const item = { trackId: 'actual-track', trackName: 'Actual track' };
function recorder() {
  const runner = new CaptureOrchestrator({ bridge: {} });
  const events = [];
  runner.addEventListener('captureprogress', event => events.push(event.detail));
  return { runner, events };
}
function mockPage(t) {
  for (const [key, value] of Object.entries({
    document: { querySelector: () => null },
    window: { location: { pathname: '/playlist/example', href: 'https://open.spotify.com/playlist/example' } },
    HTMLButtonElement: class {},
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
}

test('page teardown cancels capture without warning or overwriting a genuine failure', async t => {
  mockPage(t);
  const warnings = t.mock.method(console, 'warn', () => {});
  const stored = new Map([['ktv420:last-capture-failure', 'existing diagnostic']]);
  window.sessionStorage = { setItem: (key, value) => stored.set(key, value) };
  const runner = new CaptureOrchestrator({ bridge: { command: async () => ({}), getSnapshot: () => ({}) } });
  runner.preflightQueue = async () => {
    await runner.requestStop('Spotify page is closing.', { teardown: true });
    throw new Error('Media bridge disconnected');
  };
  await assert.rejects(runner.run({ trackIds: [item.trackId], trackSnapshot: [item] }), { name: 'AbortError' });
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(stored.get('ktv420:last-capture-failure'), 'existing diagnostic');
  assert.equal(runner.isActive(), false);
  await assert.rejects(runner.run({ trackIds: [item.trackId] }), { name: 'AbortError' });
});

test('capture progress uses the accepted item, throttles updates, and never announces persisted completion', () => {
  const { runner, events } = recorder();
  runner.updateCaptureProgress(item, { currentTime: 0, duration: 100 }, 0);
  for (let now = 50; now <= 1000; now += 50) runner.updateCaptureProgress(item, { currentTime: now / 10, duration: 100 }, now);
  assert.deepEqual(events.map(event => event.fraction), [0, 0.25, 0.5, 0.75, 0.99]);
  assert.ok(events.every(event => event.trackId === item.trackId));
  runner.updateCaptureProgress(item, { currentTime: 110, duration: 100 }, 1500);
  assert.equal(events.length, 5, 'unchanged progress is not republished');
  runner.dispatchTrackStored(item.trackId, {});
  assert.equal(events.at(-1), null, 'storage confirmation clears the capturing state');
});

test('invalid or unknown media timing is indeterminate, with finite progress clamped', () => {
  const { runner, events } = recorder();
  for (const timing of [{}, { currentTime: 1, duration: 0 }, { currentTime: 1, duration: -1 },
    { currentTime: 1, duration: Infinity }, { currentTime: NaN, duration: 100 },
    { currentTime: '20', duration: 100 }, { currentTime: 20, duration: '100' }]) {
    runner.clearCaptureProgress();
    runner.updateCaptureProgress(item, timing, 0);
    assert.deepEqual(events.at(-1), { trackId: item.trackId, fraction: null });
  }
  runner.updateCaptureProgress(item, { currentTime: -10, duration: 100 }, 300);
  assert.equal(events.at(-1).fraction, 0);
  runner.updateCaptureProgress({ trackId: 'next-track' }, { currentTime: 20, duration: 100 }, 301);
  assert.deepEqual(events.at(-1), { trackId: 'next-track', fraction: 0.2 }, 'a track transition is not throttled');
  runner.dispatchTrackStored(item.trackId, {});
  assert.equal(events.at(-1).trackId, 'next-track', 'storing an older track must not clear a newer capture');
  runner.dispatchCaptureComplete([]);
  assert.equal(events.at(-1), null);
});

test('stopping clears progress immediately and ignores in-flight polling results', async t => {
  mockPage(t);
  const { runner, events } = recorder();
  runner.updateCaptureProgress(item, { currentTime: 20, duration: 100 }, 0);
  await runner.requestStop();
  assert.equal(events.at(-1), null);
  runner.updateCaptureProgress(item, { currentTime: 30, duration: 100 }, 500);
  assert.equal(events.at(-1), null);
});

test('existing capture-state polling publishes progress without extra bridge requests', async t => {
  mockPage(t);
  const requests = [];
  const states = [
    { source: 'audio', currentTime: 40, duration: 100 },
    { source: 'audio', currentTime: 100, duration: 100, ended: true },
  ];
  const runner = new CaptureOrchestrator({ bridge: {
    command: async command => { requests.push(command); return states.shift(); },
    getSnapshot: () => ({}),
  } });
  const events = [];
  runner.addEventListener('captureprogress', event => events.push(event.detail));
  const result = await runner.recordUntilBoundary(item, {}, { events: [] });
  assert.deepEqual(requests, ['capture-state', 'capture-state']);
  assert.deepEqual(events[0], { trackId: item.trackId, fraction: 0.4 });
  assert.equal(result.reason, 'media-ended');
  assert.ok(events.every(event => event.fraction < 1));
});

test('run errors and cached completion reset progress', async t => {
  mockPage(t);
  t.mock.method(console, 'log', () => {});
  const { runner, events } = recorder();
  runner.bridge = { command: async () => ({}), getSnapshot: () => ({}) };
  runner.preflightQueue = async () => {
    runner.updateCaptureProgress(item, { currentTime: 50, duration: 100 });
    throw new Error('Capture failed');
  };
  await assert.rejects(runner.run({trackIds:[item.trackId],trackSnapshot:[item]}), /Capture failed/);
  assert.equal(events.at(-1), null);
  assert.equal(runner.isActive(), false);
  runner.preflightQueue = async () => {
    runner.updateCaptureProgress(item, { currentTime: 50, duration: 100 });
    return [{ ...item, cached: true, cachedMetadata: {} }];
  };
  await runner.run({trackIds:[item.trackId],trackSnapshot:[item]});
  assert.equal(events.at(-1), null);
  assert.equal(runner.isActive(), false);
});

test('the last capture failure survives refresh and unavailable diagnostic storage cannot mask it', async t => {
  mockPage(t);
  t.mock.method(console, 'log', () => {});
  const stored = new Map();
  window.sessionStorage = { setItem: (key, value) => stored.set(key, value) };
  const runner = new CaptureOrchestrator({ bridge: { command: async () => ({}), getSnapshot: () => ({}) } });
  runner.preflightQueue = async debug => {
    debug.phase = 'recording'; debug.trackName = 'Unwritten';
    debug.recentMediaStates.push({ currentTime: 90, previousPosition: 100 });
    throw Error('Original capture failure');
  };
  await assert.rejects(runner.run({trackIds:[item.trackId],trackSnapshot:[item]}), /Original capture failure/);
  const report = JSON.parse(stored.get('ktv420:last-capture-failure'));
  assert.equal(report.error.message, 'Original capture failure');
  assert.equal(report.phase, 'recording');
  assert.equal(report.trackName, 'Unwritten');
  assert.equal(report.recentMediaStates[0].previousPosition, 100);
  window.sessionStorage.setItem = () => { throw Error('Storage unavailable'); };
  await assert.rejects(runner.run({trackIds:[item.trackId],trackSnapshot:[item]}), /Original capture failure/);
});


test('a captured end wins over next-track metadata even when the last poll was early', async () => {
  const states = [
    { source: 'first', currentTime: 170, duration: 180 },
    { source: 'first', currentTime: 180, duration: 180, ended: true },
  ];
  const runner = new CaptureOrchestrator({ bridge: {
    command: async () => states.shift(),
    getSnapshot: () => { throw new Error('Completed capture must not consult next-track metadata'); },
  } });
  const result = await runner.recordUntilBoundary(item, {}, { events: [] });
  assert.equal(result.reason, 'media-ended');
  assert.equal(result.endMediaTime, 180);
});

test('a mid-song source replacement still fails rather than saving mixed audio', async () => {
  const states = [
    { source: 'first', currentTime: 40, duration: 180 },
    { source: 'replacement', currentTime: 40.1, duration: 180 },
  ];
  const runner = new CaptureOrchestrator({ bridge: { command: async () => states.shift() } });
  await assert.rejects(runner.recordUntilBoundary(item, {}, { events: [] }), /media source changed/);
});

test('one regressed media-clock reading recovers without discarding a healthy recording', async t => {
  mockPage(t);
  window.setTimeout = callback => { queueMicrotask(callback); return 0; };
  const states = [100, 0, 100.2, 180].map((currentTime, index) => ({
    source: 'audio', currentTime, duration: 180, ended: index === 3,
  }));
  const runner = new CaptureOrchestrator({ bridge: { command: async () => states.shift(), getSnapshot: () => ({}) } });
  const debug = { events: [] };
  assert.equal((await runner.recordUntilBoundary(item, {}, debug)).reason, 'media-ended');
  assert.equal(debug.recoveredClockReadings, 1);
  assert.equal(debug.recentMediaStates[0].previousPosition, 100);
  assert.equal(debug.recentMediaStates[0].currentTime, 0);
});

test('confirmed backward movement logs positions and stops instead of saving damaged audio', async t => {
  mockPage(t);
  window.setTimeout = callback => { queueMicrotask(callback); return 0; };
  const states = [100, 90, 90.1].map(currentTime => ({ source: 'audio', currentTime, duration: 180 }));
  const runner = new CaptureOrchestrator({ bridge: { command: async () => states.shift() } });
  const debug = { events: [] };
  await assert.rejects(runner.recordUntilBoundary(item, {}, debug), /100\.000s → 90\.100s/);
  assert.equal(debug.phase, 'recording');
  assert.deepEqual(debug.recentMediaStates.map(state => state.currentTime), [90, 90.1]);
});

test('an actual seek remains fatal immediately and retains its media evidence', async () => {
  const states = [
    { source: 'audio', currentTime: 100, duration: 180 },
    { source: 'audio', currentTime: 90, duration: 180, invalid: true, invalidReason: 'Actual seek', invalidCode: 'seek' },
  ];
  const runner = new CaptureOrchestrator({ bridge: { command: async () => states.shift() } });
  const debug = { events: [] };
  await assert.rejects(runner.recordUntilBoundary(item, {}, debug), /Actual seek/);
  assert.equal(states.length, 0);
  assert.equal(debug.recentMediaStates[0].invalidCode, 'seek');
});

test('recording observations are bounded even for a long song', async t => {
  mockPage(t);
  window.setTimeout = callback => { queueMicrotask(callback); return 0; };
  let time = 0;
  const runner = new CaptureOrchestrator({ bridge: {
    command: async () => ({ source: 'audio', currentTime: time++, duration: 100, ended: time > 100 }), getSnapshot: () => ({}),
  } });
  const debug = { events: [] };
  await runner.recordUntilBoundary(item, {}, debug);
  assert.equal(debug.recentMediaStates.length, 30);
  assert.equal(debug.recentMediaStates.at(-1).currentTime, 100);
});



test('a pause 25 ms before the end waits for resume and natural completion', async t => {
  mockPage(t);
  window.setTimeout = callback => callback();
  const states = [
    { source: 'audio', currentTime: 9.9, duration: 10 },
    { source: 'audio', currentTime: 9.975, duration: 10, paused: true },
    { source: 'audio', currentTime: 9.99, duration: 10, paused: false },
    { source: 'audio', currentTime: 10, duration: 10, ended: true },
  ];
  const runner = new CaptureOrchestrator({ bridge: {
    command: async () => states.shift(), getSnapshot: () => ({}),
  } });
  const result = await runner.recordUntilBoundary(item, {}, { events: [] });
  assert.equal(result.reason, 'media-ended');
  assert.equal(states.length, 0);
});

test('batch normalization preserves natural-end proof for the storage audit', () => {
  const { runner } = recorder();
  const capture = runner.normalizePageCapture({bytesBuffer:new ArrayBuffer(8),endVerified:true});
  assert.equal(capture.endVerified,true);
});

test('invalid capture reports its first failure immediately instead of waiting until song end', async () => {
  const states = [
    { source: 'song', currentTime: 0, duration: 180 },
    { source: 'song', currentTime: 5, duration: 180, invalid: true,
      invalidReason: 'Spotify changed position during recording (song position 5.000s; 0.200s after capture began).' },
  ];
  const runner = new CaptureOrchestrator({ bridge: {
    command: async () => { assert.ok(states.length, 'must stop polling after invalidation'); return states.shift(); },
    getSnapshot: () => { throw new Error('must report invalid capture before other playback handling'); },
  } });
  await assert.rejects(runner.recordUntilBoundary(item, {}, { events: [] }), /song position 5\.000s; 0\.200s after capture began/);
});

test('explicit Stop still cancels a single-song request and watchdog reasons are preserved', async t => {
  mockPage(t);
  const {runner}=recorder();runner.singleTrack=true;runner.active=true;
  await runner.requestStop();assert.throws(()=>runner.throwIfStopped(),/stopped by user/);
  await runner.requestStop('Capture stopped because the player stopped responding.');
  assert.throws(()=>runner.throwIfStopped(),/player stopped responding/);
});

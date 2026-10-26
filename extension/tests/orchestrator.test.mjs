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
  await assert.rejects(runner.run(), /Capture failed/);
  assert.equal(events.at(-1), null);
  assert.equal(runner.isActive(), false);
  runner.preflightQueue = async () => {
    runner.updateCaptureProgress(item, { currentTime: 50, duration: 100 });
    return [{ ...item, cached: true, cachedMetadata: {} }];
  };
  await runner.run();
  assert.equal(events.at(-1), null);
  assert.equal(runner.isActive(), false);
});

test('remote handoff ends the batch without reporting a user stop', async t => {
  mockPage(t);
  const runner = new CaptureOrchestrator({ bridge: { command: async () => ({}), getSnapshot: () => ({}) } });
  runner.preflightQueue = async () => { runner.handoff(); runner.throwIfStopped(); };
  await runner.run();
  assert.equal(runner.isActive(), false);
  assert.equal(runner.handingOff, true);
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


test('capture deduplicates playlist positions without renumbering its track snapshot', async t => {
  mockPage(t);
  const previous=Object.getOwnPropertyDescriptor(globalThis,'chrome');
  Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime:{sendMessage:async()=>({ok:true,result:[]})}}});
  t.after(()=>previous ? Object.defineProperty(globalThis,'chrome',previous) : delete globalThis.chrome);
  const runner=new CaptureOrchestrator({bridge:{}});
  const queue=await runner.preflightQueue({events:[]},null,[{...item,rowIndex:0},{...item,rowIndex:2},{trackId:'other',trackName:'Other',rowIndex:3}]);
  assert.deepEqual(queue.map(t=>[t.trackId,t.rowIndex]),[['actual-track',0],['other',3]]);
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

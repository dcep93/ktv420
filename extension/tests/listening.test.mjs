import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createListeningController } from '../src/content/listening.js';

test('listening does nothing until opened, and releases control when closed', async t => {
  const ticks = [], calls = [], updates = [];
  let reads = 0, storageReads = 0, prepares = 0;
  for (const [key, value] of Object.entries({
    document: { querySelector() { reads++; return null; }, querySelectorAll() { reads++; return []; } },
    chrome: { runtime: { async sendMessage() { storageReads++; return { ok: true, result: [] }; } } },
    setInterval(callback) { ticks.push(callback); return 0; }, clearInterval() {},
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const controller = createListeningController({
    bridge: { async command(command, payload) {
      calls.push({ command, payload });
      return command === 'listening-state' ? { media: null, volumeRevision: 0 } : {};
    } },
    emit: value => updates.push(value), ensurePlayer: () => prepares++, getRunner: () => null,
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  controller.prepareReplay(); controller.heartbeat();
  ticks[0]();
  await controller.command({ action: 'play' });
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(reads, 0); assert.equal(storageReads, 0); assert.equal(prepares, 0);
  assert.equal(updates.length, 0);

  await controller.setEnabled(true); await settle();
  assert.deepEqual(calls[0], { command: 'listening-enable', payload: { enabled: true } });
  assert.ok(reads > 0); assert.ok(storageReads > 0);
  await controller.setEnabled(false); await settle();
  assert.deepEqual(calls.at(-1), { command: 'listening-enable', payload: { enabled: false } });
  const count = calls.length, readCount = reads;
  ticks[0](); await controller.command({ action: 'play' }); await settle();
  assert.equal(calls.length, count); assert.equal(reads, readCount);
  controller.dispose();
  assert.equal(calls.length, count, 'disposing a closed controller must not inject or mute');
});

test('Stop silences and pauses, and stale playing state cannot restart capture', async t => {
  const ticks = [], calls = [], updates = [];
  let playing = true, paused = false;
  const id = '5EGTNEoUpibGgMWf6ECe0X';
  const link = { getAttribute: () => `/track/${id}` };
  const button = { disabled: false, getAttribute: () => playing ? 'Pause' : 'Play', click() { playing = false; } };
  const seek = { max: '180000', value: '0', getAttribute: () => '0:00/3:00' };
  const volumeSlider = { max: '1', value: '0.43' };
  for (const [key, value] of Object.entries({
    document: {
      querySelector: selector => selector.includes('control-button-playpause') ? button : selector.includes('now-playing-widget') ? { contains: () => true, querySelector: () => null } : null,
      querySelectorAll: selector => selector.includes('input[type="range"]') ? [seek, volumeSlider] : [link],
    },
    location: { origin: 'https://open.spotify.com' },
    chrome: { runtime: { async sendMessage(message) { return { ok: true, result: message.type === 'ktv420:listening-claim' ? true : [] }; } } },
    setInterval(callback) { ticks.push(callback); return 0; }, clearInterval() {},
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const controller = createListeningController({
    bridge: { async command(command, payload) {
      calls.push({ command, payload });
      if (command === 'listening-state') return { media: { source: 'song', readyState: 4, paused, currentTime: 0, playbackRate: 1 }, volumeRevision: 0 };
      if (command === 'capture-begin') return { target: { currentTime: 0 } };
      return {};
    } }, emit: state => updates.push(state), ensurePlayer() {}, getRunner: () => null,
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  controller.heartbeat(); await controller.setEnabled(true); await settle();
  assert.equal(calls.filter(c => c.command === 'capture-begin').length, 1);
  await controller.stopCapture(); await settle();
  assert.equal(playing, false);
  assert.equal(updates.at(-1).capturing, false);
  assert.equal(updates.at(-1).output, 'muted');
  const afterStop = calls.length;
  playing = true; ticks[0](); await settle();
  assert.equal(calls.filter(c => c.command === 'capture-begin').length, 1);
  assert.ok(calls.slice(afterStop).filter(c => c.command === 'listening-output').every(c => c.payload.gain === 0));
  playing = false; paused = true; ticks[0](); await settle();
  playing = true; paused = false; ticks[0](); await settle();
  assert.equal(calls.filter(c => c.command === 'capture-begin').length, 2, 'fresh remote playback works after observed pause');
  await controller.setEnabled(false); controller.dispose();
});

test('inherits Spotify volume and coalesces a drag without delaying pause or reverting to stale state', async t => {
  const ticks = [], timers = new Map(), writes = [], updates = [], calls = [];
  let nextTimer = 1, now = 10000;
  t.mock.method(Date, 'now', () => now);
  class Input {
    max = '1'; disabled = false; _value = '0.43';
    get value() { return this._value; }
    set value(value) { this._value = value; writes.push(Number(value)); }
    getAttribute() { return null; }
    dispatchEvent() {}
  }
  const slider = new Input();
  const seek = { max: '180000', value: '0', getAttribute: () => '0:00/3:00' };
  const button = { disabled: false, getAttribute: () => 'Play' };
  for (const [key, value] of Object.entries({
    document: {
      querySelector: selector => selector.includes('control-button-playpause') ? button : null,
      querySelectorAll: selector => selector.includes('input[type="range"]') ? [slider, seek] : [],
    },
    HTMLInputElement: Input,
    chrome: { runtime: { async sendMessage() { return { ok: true, result: [] }; } } },
    setInterval(callback) { ticks.push(callback); return 0; }, clearInterval() {},
    setTimeout(callback, delay) { assert.equal(delay, 32, 'drag must not enter the 150ms command queue'); const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const controller = createListeningController({
    bridge: { async command(command, payload) {
      calls.push({ command, payload });
      return command === 'listening-state' ? { media: null, volumeRevision: 0 } : {};
    } }, emit: state => updates.push(state), ensurePlayer() {}, getRunner: () => null,
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await controller.setEnabled(true); await settle();
  assert.equal(updates.at(-1).volume, 0.43);
  for (let i = 0; i <= 88; i++) await controller.command({ action: 'volume', volume: i / 100 });
  assert.equal(updates.at(-1).volume, 0.88, 'UI gets latest intent immediately');
  assert.equal(timers.size, 1); assert.deepEqual(writes, []);
  await controller.command({ action: 'pause' });
  ticks[0](); await settle();
  assert.equal(updates.at(-1).volume, 0.88, 'old Spotify value cannot snap the slider back during a drag');
  const flush = [...timers.values()][0]; timers.clear(); flush(); await settle();
  assert.deepEqual(writes, [0.88], 'intermediate drag values are discarded');
  assert.deepEqual(calls.at(-1), { command: 'listening-output', payload: { gain: 0 } }, 'volume never unmutes idle playback');
  now += 500; slider._value = '0.2'; ticks[0](); await settle();
  assert.equal(updates.at(-1).volume, 0.2, 'later Spotify changes still sync');
  await controller.command({ action: 'volume', volume: 0.9 });
  await controller.setEnabled(false); await settle();
  assert.equal(timers.size, 0, 'closing cancels pending writes');
  slider._value = '0';
  await controller.setEnabled(true); await settle();
  assert.equal(updates.at(-1).volume, 0, 'reopening inherits zero too');
  await controller.setEnabled(false); controller.dispose();
});

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

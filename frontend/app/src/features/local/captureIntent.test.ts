import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCaptureIntent, saveCaptureIntent } from './captureIntent';
import { HostedCaptureQueue } from './hostedCapture';

test('view recovery retains playlist order, skips committed songs, and explicit stop clears intent', async () => {
  const storage = new Map<string, string>();
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  saveCaptureIntent('playlist/first', ['saved', 'running', 'next'], store);
  assert.equal(readCaptureIntent('playlist/second', store), null);
  const resumed: string[] = [];
  await new HostedCaptureQueue().run(readCaptureIntent('playlist/first', store)!, () => new Set(['saved']),
    async id => { resumed.push(id); }, () => {});
  assert.deepEqual(resumed, ['running', 'next']);
  saveCaptureIntent('playlist/first', null, store);
  assert.equal(readCaptureIntent('playlist/first', store), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaptureOrchestrator } from '../src/content/orchestrator.js';
import { createCaptureTitle } from '../src/content/captureTitle.js';

test('whole queue includes cached songs, survives track boundaries, and completes only after saving', () => {
  const runner = new CaptureOrchestrator({ bridge: {} });
  const progress = [];
  runner.addEventListener('captureoverallprogress', event => progress.push(event.detail));
  runner.overallProgress.begin([{trackId:'cached',cached:true},{trackId:'one'},{trackId:'two'}]);
  assert.equal(progress.at(-1), 1 / 3);
  runner.updateCaptureProgress({trackId:'one'}, {currentTime:50,duration:100}, 0);
  assert.equal(progress.at(-1), .5);
  runner.clearCaptureProgress();
  assert.equal(progress.at(-1), .5, 'a boundary does not reset the queue');
  runner.dispatchTrackStored('one', {});
  assert.equal(progress.at(-1), 2 / 3);
  runner.updateCaptureProgress({trackId:'two'}, {currentTime:100,duration:100}, 300);
  assert.ok(progress.at(-1) < 1, 'playing to the end does not prove persistence');
  runner.dispatchTrackStored('two', {});
  assert.equal(progress.at(-1), 1);
  runner.active = true; runner.handoff();
  assert.equal(progress.at(-1), null);
  runner.updateCaptureProgress({trackId:'two'}, {currentTime:80,duration:100}, 600);
  assert.equal(progress.at(-1), null, 'a late poll cannot revive a stopped title');
});

test('title prefix follows Spotify title changes without accumulating and restores the latest title', () => {
  let notify;
  class Observer { constructor(callback) { notify = callback; } observe() {} disconnect() {} }
  const doc = { title: 'First song • Spotify', head: {} };
  const title = createCaptureTitle(doc, Observer);
  title.set(.427);
  assert.equal(doc.title, '[42%] ktv420 — First song • Spotify');
  notify(); title.set(.427);
  assert.equal(doc.title, '[42%] ktv420 — First song • Spotify');
  doc.title = 'Second song • Spotify'; notify();
  assert.equal(doc.title, '[42%] ktv420 — Second song • Spotify');
  title.set(.9999);
  assert.match(doc.title, /^\[99%\]/);
  title.set(null);
  assert.equal(doc.title, 'Second song • Spotify');
  title.set(.7); title.dispose();
  assert.equal(doc.title, 'Second song • Spotify');
});

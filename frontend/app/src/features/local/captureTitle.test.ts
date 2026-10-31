import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePercentage } from './capturePercentage';
import { createCaptureTitle, createTitlePublisher, setCaptureDocumentTitle } from './captureTitle';

test('song handoff retains progress until saved rows and the next capture catch up', () => {
  const title = createCaptureTitle();
  const ids = ['a', 'b', 'c', 'd'];
  const updates: string[] = [];
  const publish = createTitlePublisher(value => updates.push(value));
  const update = (saved: string[], progress: { trackId: string; fraction: number } | null) =>
    publish(title(true, ids.length, capturePercentage(ids, new Set(saved), progress)));
  update([], { trackId: 'a', fraction: 0.99 });
  update([], { trackId: 'a', fraction: 1 });
  update([], null); // The extension clears its single-song progress before metadata arrives.
  update([], { trackId: 'b', fraction: 0 });
  update(['a'], { trackId: 'b', fraction: 0 });
  update(['a'], { trackId: 'b', fraction: 0.5 });
  assert.deepEqual(updates, ['24% · ktv420', '25% · ktv420', '37% · ktv420']);
});

test('capture title handles retry, completion, cancellation and a fresh run', () => {
  const title = createCaptureTitle();
  assert.equal(title(true, 4, 60), '60% · ktv420');
  assert.equal(title(true, 4, 50), '60% · ktv420');
  assert.equal(title(true, 0, 0), '60% · ktv420');
  assert.equal(title(true, 4, NaN), '60% · ktv420');
  assert.equal(title(true, 4, 100), '99% · ktv420');
  assert.equal(title(false, 4, 100), 'ktv420');
  assert.equal(title(true, 4, 0), '0% · ktv420');
  assert.equal(title(false, 4, 0), 'ktv420');
});

test('title relay publishes initial and changed titles only', () => {
  const sent: string[] = [];
  const publish = createTitlePublisher(title => sent.push(title));
  for (const title of ['ktv420', 'ktv420', '25% · ktv420', '25% · ktv420', 'ktv420']) publish(title);
  assert.deepEqual(sent, ['ktv420', '25% · ktv420', 'ktv420']);
});


test('unchanged progress does not rewrite the document title', () => {
  let value = 'ktv420', writes = 0;
  const document = { get title() { return value; }, set title(next: string) { writes++; value = next; } };
  setCaptureDocumentTitle(document, 'ktv420');
  setCaptureDocumentTitle(document, '25% · ktv420');
  setCaptureDocumentTitle(document, '25% · ktv420');
  assert.equal(writes, 1);
  assert.equal(document.title, '25% · ktv420');
});

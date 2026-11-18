import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureStatusInbox } from './captureStatus';
test('completion before the response is retained; later completion wakes without polling', async () => {
  const target = new EventTarget(), inbox = captureStatusInbox(target);
  const send = (id: string) => target.dispatchEvent(new CustomEvent('ktv420:spotify-status', { detail: { request: { id, state: 'complete', error: '' } } }));
  send('first'); await inbox.wait();
  assert.equal(inbox.take('first')?.request?.state, 'complete');
  const waiting = inbox.wait(); send('second'); await waiting;
  assert.equal(inbox.take('second')?.request?.state, 'complete');
  send('unrelated'); assert.equal(inbox.take('second'), undefined);
  const disposal = inbox.wait(); inbox.dispose(); await disposal;
  send('second'); assert.equal(inbox.take('second'), undefined);
});

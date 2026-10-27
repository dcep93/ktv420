import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionRegistration } from '../src/content/collectionRegistration.js';
const collection = { path: 'album/1111111111111111111111', title: 'Album', artwork: '', trackIds: ['one'] };
const setup = overrides => createCollectionRegistration({
  getPath: () => `/${collection.path}`, onError() {}, wait: async () => {}, ...overrides,
});

test('retries negative acknowledgements and clears the catalog error after success', async () => {
  let calls = 0; const errors = [], delays = [];
  const register = setup({ send(message, respond) {
    assert.equal(message.started, true);
    respond(++calls < 3 ? { ok: false, error: 'Worker unavailable' } : { ok: true });
  }, onError: error => errors.push(error), wait: async delay => { delays.push(delay); } });
  assert.equal(await register(collection, true), true);
  assert.equal(calls, 3); assert.deepEqual(delays, [400, 1200]);
  assert.deepEqual(errors, ['']);
});

test('persistent failures are visible but resolve without throwing into capture', async () => {
  let calls = 0; const errors = [];
  const register = setup({send() { calls++; throw Error('Extension context invalidated'); }, onError: error => errors.push(error)});
  assert.equal(await register(collection, true), false);
  assert.equal(calls, 3); assert.match(errors[0], /Catalog.*Extension context invalidated/);
});

test('missing replies time out and retry rather than hanging capture forever', async () => {
  let calls = 0; let error;
  const register = setup({ send() { calls++; }, timeoutMs: 5, onError: value => { error = value; } });
  assert.equal(await register(collection), false);
  assert.equal(calls, 3); assert.match(error, /timed out/i);
});

test('navigation cancels stale retries and prevents stale errors from reaching the new page', async () => {
  let path = `/${collection.path}`, calls = 0;
  const register = setup({ getPath: () => path, send(_message, respond) { calls++; respond({ok:false,error:'offline'}); },
    wait: async () => { path = '/album/2222222222222222222222'; },
    onError() { assert.fail('stale request changed the new page error'); } });
  assert.equal(await register(collection), false); assert.equal(calls, 1);
});

test('registration is serial and snapshots membership before asynchronous work', async () => {
  const pending = []; const sent = [];
  const register = setup({ send(message, respond) { sent.push(message); pending.push(respond); } });
  const value = { ...collection, trackIds: ['one'] };
  const first = register(value); value.trackIds.push('two');
  const second = register(value, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].collection.trackIds, ['one']);
  pending.shift()({ok:true}); await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].collection.trackIds, ['one', 'two']);
  pending.shift()({ok:true}); assert.equal(await second, true);
});

test('empty loading metadata does not register or display a failure', async () => {
  const register = setup({send() { assert.fail('sent an incomplete collection'); }, onError() { assert.fail('loading is not an error'); }});
  assert.equal(await register({...collection,trackIds:[]}), false);
});

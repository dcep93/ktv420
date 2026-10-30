import { test } from 'node:test';
import assert from 'node:assert/strict';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let listener: Listener, external: Listener;
let currentUrl = 'https://open.spotify.com/playlist/1wOJr3rvMmPRPnyFBA7n3Z';
const delivered: { tabId: number; message: Record<string, unknown>; frameId: number }[] = [];
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const host = `chrome-extension://${extensionId}/src/overlay/index.html`;
globalThis.chrome = {
  runtime: {
    id: extensionId,
    getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    getManifest: () => ({ version: '7.1.0' }),
    onMessage: { addListener: (value: Listener) => { listener = value; } },
    onMessageExternal: { addListener: (value: Listener) => { external = value; } },
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: {
    get: async () => ({ id: 7, url: currentUrl }),
    sendMessage: async (tabId: number, message: Record<string, unknown>, options: { frameId: number }) => {
      delivered.push({ tabId, message, ...options });
      return { ok: true, result: { tracks: [] } };
    },
  },
} as unknown as typeof chrome;
await import('./background');
const sender = { id: extensionId, frameId: 4, url: `${host}?id=playlist.1wOJr3rvMmPRPnyFBA7n3Z`, tab: { id: 7 } as chrome.tabs.Tab };
const request = { protocol: 'ktv420-spotify', version: 1, operation: 'discover' };
function call(message: unknown, from = sender, receive = listener) {
  return new Promise<{ ok: boolean; error?: string }>(resolve => {
    const accepted: unknown = receive(message, from, resolve);
    if (!accepted) resolve({ ok: false });
  });
}
test('overlay commands bind to the enclosing Spotify tab, including SPA navigation', async () => {
  assert.equal((await call({ type: 'ktv420:overlay-request', request })).ok, true);
  assert.equal(delivered[0].tabId, 7);
  assert.equal(delivered[0].frameId, 0);
  assert.equal(delivered[0].message.operation, 'discover');
  assert.equal('tabId' in delivered[0].message, false);
  currentUrl = 'https://open.spotify.com/album/19cvoEE5d3pMkxLFL5TsAG/';
  assert.equal((await call({ type: 'ktv420:overlay-request', request })).ok, true);
  currentUrl = 'https://example.com/';
  assert.equal((await call({ type: 'ktv420:overlay-request', request })).ok, false);
  assert.equal(delivered.length, 2);
  currentUrl = 'https://open.spotify.com/';
});
test('website and Spotify pages cannot impersonate the packaged overlay or choose another tab', async () => {
  const message = { type: 'ktv420:overlay-request', request };
  for (const from of [
    { ...sender, frameId: 0 },
    { ...sender, url: 'https://ktv420.web.app/playlist?overlay=1' },
    { ...sender, url: 'https://open.spotify.com/' },
    { ...sender, id: 'another-extension' },
  ]) assert.equal((await call(message, from)).ok, false);
  assert.equal((await call({ ...message, request: { ...request, tabId: 99 } })).ok, false);
  assert.equal((await call(request, { ...sender, url: 'https://ktv420.web.app/', frameId: 0 }, external)).ok, false);
  assert.equal((await call({ ...request, operation: 'hello' }, { ...sender, url: 'https://ktv420.web.app/', frameId: 0 }, external)).ok, true);
  assert.equal(delivered.length, 2);
});

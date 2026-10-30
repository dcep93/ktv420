import { test } from 'node:test';
import assert from 'node:assert/strict';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let listener: Listener;
let currentUrl = 'https://open.spotify.com/playlist/1wOJr3rvMmPRPnyFBA7n3Z';
const opened: string[] = [];
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
globalThis.chrome = {
  runtime: {
    id: extensionId,
    onMessage: { addListener: (value: Listener) => { listener = value; } },
    onMessageExternal: { addListener: () => {} },
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: {
    get: async () => ({ id: 7, url: currentUrl }),
    query: async () => [],
    create: async ({ url }: { url: string }) => { opened.push(url); },
  },
} as unknown as typeof chrome;
await import('./background');

test('launch uses current Spotify route after SPA navigation, never stale sender URL', async () => {
  const launch = () => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    listener({ type: 'ktv420:open-app' }, {
      id: extensionId, frameId: 0, url: 'https://open.spotify.com/',
      tab: { id: 7 } as chrome.tabs.Tab,
    }, resolve);
  });
  assert.equal((await launch()).ok, true);
  const url = new URL(opened[0]);
  assert.equal(url.origin, 'https://ktv420.web.app');
  assert.equal(url.searchParams.get('id'), 'playlist.1wOJr3rvMmPRPnyFBA7n3Z');
  assert.equal(url.searchParams.get('spotifyTab'), '7');
  currentUrl = 'https://open.spotify.com/album/19cvoEE5d3pMkxLFL5TsAG/';
  assert.equal((await launch()).ok, true);
  assert.equal(new URL(opened[1]).searchParams.get('id'), 'album.19cvoEE5d3pMkxLFL5TsAG');
  currentUrl = 'https://example.com/playlist/1wOJr3rvMmPRPnyFBA7n3Z';
  assert.equal((await launch()).ok, false);
  assert.equal(opened.length, 2);
});

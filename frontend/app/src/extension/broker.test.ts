import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrokerBridge } from './broker.ts';
import type { createLibraryBrokerSession } from './libraryBroker.ts';

test('bridge requires exact origins/windows/version and relays only whitelisted commands after ready', async () => {
  const parentMessages: unknown[] = [], playerMessages: unknown[] = [], errors: string[] = [];
  const parent = { postMessage: (value: unknown, origin: string) => { assert.equal(origin, 'https://open.spotify.com'); parentMessages.push(value); } } as Window;
  const player = { postMessage: (value: unknown, origin: string) => { assert.equal(origin, 'https://ktv420.web.app'); playerMessages.push(value); } } as Window;
  let disposed = 0, handled = 0;
  const bridge = createBrokerBridge({ parent, player, parentOrigin: 'https://open.spotify.com', playerOrigin: 'https://ktv420.web.app', showError: message => errors.push(message),
    createSession: () => ({ dispose: async () => { disposed++; }, handle: async () => { handled++; return { source: 'ktv420-library', version: 1, id: 'one', ok: true }; } }) as ReturnType<typeof createLibraryBrokerSession>,
  });
  const fromPlayer = (data: unknown, origin = 'https://ktv420.web.app', source: Window = player) => bridge.receive({ data, origin, source });
  const command = { source: 'ktv420-overlay', version: 1, type: 'ready' };
  await fromPlayer(command, 'https://evil.example'); await fromPlayer(command, 'https://ktv420.web.app', parent);
  assert.equal(parentMessages.length, 0);
  await fromPlayer({ ...command, version: 2 }); assert.equal(errors.length, 1);
  await fromPlayer({ ...command, type: 'toggle-capture' }); assert.equal(parentMessages.length, 0);
  const state = { source: 'ktv420-parent', version: 1, type: 'state', tracks: [], active: false, starting: false, supported: true };
  await bridge.receive({ source: parent, origin: 'https://evil.example', data: state });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: state });
  assert.equal(playerMessages.length, 0);
  await fromPlayer(command); assert.equal(parentMessages.length, 1); assert.equal(playerMessages.length, 1);
  assert.equal((parentMessages[0] as { version: number }).version, 1);
  assert.equal((playerMessages[0] as { version: number }).version, 1);
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: { ...state, version: 2 } });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: { ...state, version: undefined } });
  assert.equal(playerMessages.length, 1);
  assert.equal(errors.length, 3);
  assert.match(errors[2], /Spotify bridge version mismatch/);
  await fromPlayer({ ...command, type: 'chrome.runtime' }); assert.equal(parentMessages.length, 1);
  await fromPlayer({ ...command, type: 'close' }); await fromPlayer({ ...command, type: 'toggle-capture' });
  assert.equal(parentMessages.length, 3);
  const rpc = { source: 'ktv420-library', version: 1, id: 'one', method: 'listTracks', args: [] };
  await fromPlayer(rpc, 'https://evil.example'); assert.equal(handled, 0);
  await fromPlayer(rpc); assert.equal(handled, 1);
  await bridge.reload(); assert.equal(disposed, 0); // first load preserves the startup handshake
  await bridge.reload(); assert.equal(disposed, 1);
  await fromPlayer({ ...command, type: 'toggle-capture' }); assert.equal(parentMessages.length, 3);
  await fromPlayer(command); assert.equal(parentMessages.length, 4);
  await bridge.dispose(); assert.equal(disposed, 2);
  await fromPlayer(command); assert.equal(parentMessages.length, 4);
});

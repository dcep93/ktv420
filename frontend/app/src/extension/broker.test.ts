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
    createSession: () => ({ dispose: async () => { disposed++; }, handle: async () => { handled++; return { source: 'ktv420-library', version: 2, id: 'one', ok: true }; } }) as ReturnType<typeof createLibraryBrokerSession>,
  });
  const fromPlayer = (data: unknown, origin = 'https://ktv420.web.app', source: Window = player) => bridge.receive({ data, origin, source });
  const command = { source: 'ktv420-overlay', version: 2, type: 'ready' };
  await fromPlayer(command, 'https://evil.example'); await fromPlayer(command, 'https://ktv420.web.app', parent);
  assert.equal(parentMessages.length, 0);
  await fromPlayer({ ...command, version: 1 }); assert.equal(errors.length, 1);
  await fromPlayer({ ...command, type: 'toggle-capture' }); assert.equal(parentMessages.length, 0);
  const state = { source: 'ktv420-parent', version: 2, type: 'state', tracks: [], active: false, starting: false, supported: true };
  await bridge.receive({ source: parent, origin: 'https://evil.example', data: state });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: state });
  assert.equal(playerMessages.length, 0);
  await fromPlayer(command); assert.equal(parentMessages.length, 1); assert.equal(playerMessages.length, 1);
  assert.equal((parentMessages[0] as { version: number }).version, 2);
  assert.equal((playerMessages[0] as { version: number }).version, 2);
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: { ...state, version: 1 } });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: { ...state, version: undefined } });
  assert.equal(playerMessages.length, 1);
  assert.equal(errors.length, 3);
  assert.match(errors[2], /Spotify bridge version mismatch/);
  await fromPlayer({ ...command, type: 'chrome.runtime' }); assert.equal(parentMessages.length, 1);
  await fromPlayer({ ...command, type: 'close' }); await fromPlayer({ ...command, type: 'toggle-capture' });
  assert.equal(parentMessages.length, 3);
  const rpc = { source: 'ktv420-library', version: 2, id: 'one', method: 'listTracks', args: [] };
  await fromPlayer(rpc, 'https://evil.example'); assert.equal(handled, 0);
  await fromPlayer(rpc); assert.equal(handled, 1);
  await bridge.reload(); assert.equal(disposed, 0); // first load preserves the startup handshake
  await bridge.reload(); assert.equal(disposed, 1);
  await fromPlayer({ ...command, type: 'toggle-capture' }); assert.equal(parentMessages.length, 3);
  await fromPlayer(command); assert.equal(parentMessages.length, 4);
  await bridge.dispose(); assert.equal(disposed, 2);
  await fromPlayer(command); assert.equal(parentMessages.length, 4);
});

test('bridge validates optional capture progress and forwards only its sanitized shape from the trusted parent', async () => {
  const messages: Record<string, unknown>[] = [];
  const parent = { postMessage() {} } as unknown as Window;
  const player = { postMessage: (data: Record<string, unknown>) => messages.push(data) } as unknown as Window;
  const bridge = createBrokerBridge({ parent, player, parentOrigin: 'https://open.spotify.com', playerOrigin: 'https://ktv420.web.app', showError() {},
    createSession: () => ({ dispose: async () => {}, handle: async () => ({ source: 'ktv420-library', version: 2, id: 'test', ok: true }) }) as ReturnType<typeof createLibraryBrokerSession>,
  });
  await bridge.receive({ source: player, origin: 'https://ktv420.web.app', data: { source: 'ktv420-overlay', version: 2, type: 'ready' } });
  const state = { source: 'ktv420-parent', version: 2, type: 'state', tracks: [], active: true, starting: false, supported: true };
  const send = (captureProgress: unknown, source = parent, origin = 'https://open.spotify.com') =>
    bridge.receive({ source, origin, data: { ...state, captureProgress } });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: state });
  assert.equal(Object.hasOwn(messages.at(-1)!, 'captureProgress'), false, 'old state messages remain compatible');
  for (const fraction of [0, 0.4, 1, null]) {
    await send({ trackId: 'actual-track', fraction, privateData: { secret: 'stripped' } });
    assert.deepEqual(messages.at(-1)!.captureProgress, { trackId: 'actual-track', fraction });
  }
  await send(null);
  assert.equal(messages.at(-1)!.captureProgress, null);
  const count = messages.length;
  for (const invalid of [[], '0.5', {}, { trackId: '', fraction: 0 }, { trackId: 1, fraction: 0 },
    { trackId: 'x'.repeat(4097), fraction: 0 }, { trackId: 'track' }, { trackId: 'track', fraction: '0.5' },
    { trackId: 'track', fraction: NaN }, { trackId: 'track', fraction: Infinity },
    { trackId: 'track', fraction: -0.1 }, { trackId: 'track', fraction: 1.1 }]) await send(invalid);
  await send({ trackId: 'track', fraction: 0.5 }, player);
  await send({ trackId: 'track', fraction: 0.5 }, parent, 'https://evil.example');
  assert.equal(messages.length, count, 'malformed or untrusted progress never reaches the hosted player');
  await bridge.dispose();
});


test('transport and heartbeat require the ready hosted peer and sanitize commands', async () => {
  const messages: Record<string, unknown>[] = [];
  const parent = { postMessage: (data: Record<string, unknown>) => messages.push(data) } as unknown as Window;
  const player = { postMessage() {} } as unknown as Window;
  const bridge = createBrokerBridge({ parent, player, parentOrigin: 'https://open.spotify.com', playerOrigin: 'https://ktv420.web.app', showError() {},
    createSession: () => ({ dispose: async () => {}, handle: async () => ({ source: 'ktv420-library', version: 2, id: 'test', ok: true }) }) as ReturnType<typeof createLibraryBrokerSession>,
  });
  const send = (type: string, command?: unknown, source = player, origin = 'https://ktv420.web.app') =>
    bridge.receive({ source, origin, data: { source: 'ktv420-overlay', version: 2, type, command } });
  await send('transport', { action: 'play' }); await send('listening-heartbeat');
  assert.equal(messages.length, 0);
  await send('ready');
  await send('transport', { action: 'seek', trackId: 'abc', position: 12, script: 'stripped' });
  assert.deepEqual(messages.at(-1)?.command, { action: 'seek', trackId: 'abc', position: 12 });
  await send('listening-heartbeat');
  const count = messages.length;
  await send('transport', { action: 'volume', volume: Infinity });
  await send('transport', { action: 'play' }, parent);
  await send('listening-heartbeat', undefined, player, 'https://evil.example');
  assert.equal(messages.length, count);
  await bridge.dispose();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountButton } from '../src/content/ui.js';

test('overlay waits for a trusted ready message, then sends cloneable DOM track metadata', async t => {
  const elements = [];
  const messages = [];
  const timers = [];
  const listeners = {};
  const trackId = '5EGTNEoUpibGgMWf6ECe0X';
  const row = {
    querySelector: () => ({ getAttribute: () => `/track/${trackId}`, textContent: 'Common Enemy' }),
    querySelectorAll: () => [],
  };
  // Like an HTMLDivElement, this row cannot cross postMessage's clone boundary.
  assert.throws(() => structuredClone(row), { name: 'DataCloneError' });
  const makeElement = tag => {
    const element = { tag, dataset: {}, style: {}, children: [], listeners: {},
      setAttribute() {}, remove() {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      append(child) { this.children.push(child); child.parentElement = this; child.isConnected = true; },
    };
    if (tag === 'iframe') element.contentWindow = { postMessage: (data, origin) => {
      assert.equal(origin, 'chrome-extension://test');
      messages.push(structuredClone(data));
    } };
    elements.push(element);
    return element;
  };
  const parent = makeElement('nav');
  const globals = {
    document: {
      getElementById: () => null,
      createElement: makeElement,
      documentElement: makeElement('html'), body: makeElement('body'),
      querySelector: selector => selector.includes('logoSpotify')
        ? { closest: () => ({ parentElement: parent }) }
        : { querySelectorAll: () => [row] },
    },
    window: { location: { pathname: '/playlist/example' },
      addEventListener(name, listener) { listeners[name] = listener; }, removeEventListener() {} },
    location: { pathname: '/playlist/example' },
    chrome: { runtime: { getManifest: () => ({ version: '0.4.0' }), getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener() {}, removeListener() {} } } },
    setInterval: callback => { timers.push(callback); return 1; },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const ui = mountButton({ isRunActive: () => false, onToggleRun: async () => {}, loadSpotifyTracks: async () => [] });
  elements.find(element => element.id === 'ktv420-spotify-capture-button').onclick();
  await new Promise(resolve => setImmediate(resolve));
  const frame = elements.find(element => element.tag === 'iframe');
  frame.listeners.load?.();
  ui.refresh();
  timers[0]();
  assert.equal(messages.length, 0, 'loading/about:blank frames must receive no state messages');
  const ready = { source: frame.contentWindow, origin: 'chrome-extension://test', data: { source: 'ktv420-overlay', version: 1, type: 'ready' } };
  await listeners.message({ ...ready, origin: 'https://open.spotify.com' });
  await listeners.message({ ...ready, source: {} });
  await listeners.message({ ...ready, data: { source: 'untrusted', type: 'ready' } });
  await listeners.message({ ...ready, data: { ...ready.data, version: 2 } });
  ui.refresh();
  assert.equal(messages.length, 0, 'a different origin or window cannot unlock state delivery');
  await listeners.message(ready);
  ui.refresh();
  timers[0]();
  assert.ok(messages.length > 0);
  for (const message of messages.filter(message => message.tracks.length)) {
    assert.equal(message.supported, true);
    assert.deepEqual(message.tracks, [{ trackId, trackName: 'Common Enemy', trackArtist: '', trackArtworkSrc: '', rowIndex: 0 }]);
  }
  assert.equal(messages.at(-1).tracks.length, 1);
});

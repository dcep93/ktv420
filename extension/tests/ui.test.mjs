import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountButton } from '../src/content/ui.js';

test('DOM fallback tracks reach the overlay without sending their HTML rows', async t => {
  const elements = [];
  const messages = [];
  const timers = [];
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
    if (tag === 'iframe') element.contentWindow = { postMessage: data => messages.push(structuredClone(data)) };
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
    window: { location: { pathname: '/playlist/example' }, addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/playlist/example' },
    chrome: { runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener() {}, removeListener() {} } } },
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
  elements.find(element => element.tag === 'iframe').listeners.load();
  ui.refresh();
  timers[0]();
  assert.ok(messages.length > 0);
  for (const message of messages.filter(message => message.tracks.length)) {
    assert.equal(message.supported, true);
    assert.deepEqual(message.tracks, [{ trackId, trackName: 'Common Enemy', trackArtist: '', trackArtworkSrc: '', rowIndex: 0 }]);
  }
  assert.equal(messages.at(-1).tracks.length, 1);
});

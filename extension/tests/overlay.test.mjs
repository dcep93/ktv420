import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const id = 'abcdefghijklmnopabcdefghijklmnop';
const extension = `chrome-extension://${id}`;
const app = 'https://ktv420.web.app';
const spotify = 'https://open.spotify.com';
test('packaged host waits for the real child and rejects forged cross-window requests', () => {
  const childMessages = [], parentMessages = [], requests = [], listeners = {};
  const child = { postMessage: (...args) => childMessages.push(args) };
  const parent = { postMessage: (...args) => parentMessages.push(args) };
  const frame = { contentWindow: child };
  const chrome = { runtime: { sendMessage: (r, cb) => { requests.push(r); cb({ ok: true, result: 42 }); } } };
  vm.runInNewContext(readFileSync(new URL('../src/overlay/host.js', import.meta.url), 'utf8'), {
    URL, URLSearchParams, chrome, parent,
    location: { search: '?id=album.19cvoEE5d3pMkxLFL5TsAG&ktv420=2' },
    document: { querySelector: () => frame },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
  });
  const url = new URL(frame.src);
  assert.equal(url.searchParams.get('overlay'), '1');
  assert.equal(url.searchParams.get('ktv420'), '2');
  assert.equal(url.searchParams.has('spotifyTab'), false);
  assert.equal(childMessages.length, 0); // Avoid the about:blank origin mismatch.
  assert.equal(parentMessages[0][1], spotify);
  const send = (source, origin, data) => listeners.message({ source, origin, data });
  const message = { source: 'ktv420-overlay-app', type: 'request', id: 'request', request: { operation: 'status' } };
  send(parent, app, message);
  send(child, spotify, message);
  assert.equal(requests.length, 0);
  send(child, app, { source: 'ktv420-overlay-app', type: 'ready' });
  assert.equal(childMessages[0][0].trackIndex, 2);
  assert.equal(childMessages[0][1], app);
  send(child, app, message);
  assert.equal(requests[0].type, 'ktv420:overlay-request');
  assert.equal(childMessages.at(-1)[0].result, 42);
  send(parent, spotify, { source: 'ktv420-spotify-host', type: 'navigation', open: false, trackIndex: null });
  assert.equal(childMessages.at(-1)[0].open, false);
});
test('overlay restores Spotify on close, reuses its frame and synchronizes one-based track links', () => {
  let location = new URL(`${spotify}/album/19cvoEE5d3pMkxLFL5TsAG?ktv420=2`);
  const listeners = {}, messages = [], frames = [];
  let tick, closed = 0;
  const favicon = { href: '/spotify.ico', getAttribute() { return this.href; }, setAttribute(_key, value) { this.href = value; } };
  const document = {
    title: 'Spotify album', documentElement: { style: { overflow: 'auto' } },
    body: { append(frame) { frame.isConnected = true; frames.push(frame); } },
    querySelectorAll: () => [favicon],
    createElement: () => ({ style: {}, contentWindow: { postMessage: (...args) => messages.push(args) }, focus() {}, remove() { this.isConnected = false; } }),
  };
  const context = {
    URL, URLSearchParams, document,
    chrome: { runtime: { getURL: path => `${extension}/${path}` } },
    isSupportedRoute: () => /^\/(album|playlist)\//.test(location.pathname),
    setInterval: fn => { tick = fn; },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    history: { state: {}, pushState(_state, _title, url) { location = new URL(url); }, replaceState(_state, _title, url) { location = new URL(url); } },
    onClose: () => { closed++; },
    get location() { return location; },
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../src/content/overlay.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export function', 'function');
  vm.runInContext(`${source}\nthis.overlay = createOverlay({ onClose });`, context);
  tick();
  assert.equal(frames.length, 1);
  assert.equal(new URL(frames[0].src).searchParams.get('ktv420'), '2');
  assert.equal(messages.length, 0);
  listeners.message({ source: frames[0].contentWindow, origin: extension, data: { source: 'ktv420-extension-host', type: 'ready' } });
  assert.equal(messages.at(-1)[0].trackIndex, 2);
  assert.equal(messages.at(-1)[1], extension);
  context.overlay.setView(3, false);
  assert.equal(location.searchParams.get('ktv420'), '3');
  tick();
  assert.equal(frames.length, 1);
  listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(closed, 1);
  assert.equal(frames[0].hidden, true);
  assert.equal(messages.at(-1)[0].open, false);
  assert.equal(location.searchParams.has('ktv420'), false);
  assert.equal(document.title, 'Spotify album');
  assert.equal(favicon.href, '/spotify.ico');
  assert.equal(document.documentElement.style.overflow, 'auto');
  context.overlay.show();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].hidden, false);
  assert.equal(location.searchParams.get('ktv420'), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const hookSource = readFileSync(new URL('../src/page/spotifyHooks.js', import.meta.url), 'utf8');

// Run the shipped page script through its real command bridge. Browser audio
// primitives are mocked, but source selection and capture lifecycle are not.
function harness(definitions, onWait = () => {}) {
  class Media {
    constructor(values) { Object.assign(this, { src: 'song', currentSrc: '', currentTime: 0, duration: 180,
      readyState: 4, playbackRate: 1, paused: false, ended: false, tagName: 'AUDIO', _volume: 1, _muted: false }, values); }
    get volume() { return this._volume; }
    set volume(value) { this._volume = value; }
    get muted() { return this._muted; }
    set muted(value) { this._muted = value; }
    addEventListener() {}
    removeEventListener() {}
    play() { this.paused = false; return Promise.resolve(); }
  }
  const elements = definitions.map(value => new Media(value));
  const graphs = [];
  class AudioContext {
    state = 'running'; currentTime = 0; sampleRate = 44100; destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaElementSource(element) { graphs.push(element); return { connect() {} }; }
    createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} }, connect() {} }; }
    async resume() { this.state = 'running'; }
  }
  class Document {
    currentScript = { dataset: { ktv420WorkletUrl: 'worklet.js' } };
    querySelectorAll() { return elements; }
    createElement() { return {}; }
    createElementNS() { return {}; }
  }
  class XHR { open() {} send() {} }
  let now = 0, commandListener, reply;
  const window = { location: { origin: 'https://open.spotify.com' }, AudioContext,
    fetch() {}, setInterval() {},
    setTimeout(callback, delay) { now += delay; onWait(elements, now); callback(); },
    addEventListener(type, listener) { if (type === 'message') commandListener = listener; },
    postMessage(message) { if (message.event === 'command-result') reply = message.payload; },
  };
  const context = vm.createContext({ window, document: new Document(), Document, HTMLMediaElement: Media,
    XMLHttpRequest: XHR, navigator: {}, performance: { now: () => now }, setInterval() {},
    AudioWorkletNode: class { port = {}; }, console, Uint8Array, ArrayBuffer });
  vm.runInContext(hookSource, context);
  return { elements, graphs, async command(command, payload = {}) {
    reply = null;
    await commandListener({ source: window, data: { source: 'ktv420_content', commandId: 1, command, payload } });
    assert.ok(reply, 'bridge must reply');
    return reply;
  } };
}

test('capture, listening and tempo select playing audio over a preloaded paused element', async () => {
  const h = harness([{ src: 'preloaded', paused: true }, { src: 'current', _muted: true, _volume: 0 }]);
  const state = await h.command('listening-state');
  assert.equal(state.result.media.source, 'current');
  const capture = await h.command('capture-begin');
  assert.equal(capture.ok, true);
  assert.equal(capture.result.target.source, 'current');
  assert.equal(capture.result.sampleRate, 44100);
  assert.deepEqual(h.graphs, [h.elements[1]], 'only the selected element feeds capture');
  assert.equal((await h.command('listening-rate', { rate: 1.25 })).ok, true);
  assert.equal(h.elements[0].playbackRate, 1);
  assert.equal(h.elements[1].playbackRate, 1.25);
});

test('ended and unusable elements cannot displace a sole paused target', async () => {
  const h = harness([{ src: 'ended', ended: true }, { src: 'current', paused: true },
    { src: 'unloaded', readyState: 0 }, { src: 'invalid', duration: NaN }]);
  assert.equal((await h.command('listening-state')).result.media.source, 'current');
  assert.equal((await h.command('capture-begin')).result.target.source, 'current');
});

test('two playing sources stay ambiguous and never attach a capture graph', async () => {
  const h = harness([{ src: 'one' }, { src: 'two' }]);
  assert.equal((await h.command('listening-state')).result.media, null);
  assert.equal((await h.command('listening-rate', { rate: 1.2 })).ok, false);
  const result = await h.command('capture-begin', { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.match(result.error, /2 playing elements out of 2 loaded/);
  assert.deepEqual(h.graphs, []);
});

test('two paused sources remain ambiguous rather than recording the wrong song', async () => {
  const h = harness([{ paused: true }, { paused: true }]);
  const result = await h.command('capture-begin', { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.match(result.error, /0 playing elements out of 2 loaded/);
  assert.deepEqual(h.graphs, []);
});

test('capture waits for transient overlap to settle', async () => {
  const h = harness([{ src: 'previous' }, { src: 'current' }], elements => { elements[0].paused = true; });
  const result = await h.command('capture-begin', { timeoutMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.result.target.source, 'current');
});

test('successive captures follow the next active element, not the previous graph', async () => {
  const h = harness([{ src: 'first' }, { src: 'second', paused: true }]);
  assert.equal((await h.command('capture-begin')).result.target.source, 'first');
  h.elements[0].paused = true;
  h.elements[1].paused = false;
  const next = await h.command('capture-finish-and-begin');
  assert.equal(next.ok, true);
  assert.equal(next.result.next.target.source, 'second');
  assert.deepEqual(h.graphs, h.elements);
});

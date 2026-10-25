import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const hookSource = readFileSync(new URL('../src/page/spotifyHooks.js', import.meta.url), 'utf8');

// Run the shipped page script through its real command bridge. Browser audio
// primitives are mocked, but source selection and capture lifecycle are not.
function harness(definitions, onWait = () => {}, timeline = null, activate = true) {
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
  const gains = new Map();
  class AudioContext {
    state = 'running'; currentTime = 0; sampleRate = 44100; destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaElementSource(element) { this.element = element; graphs.push(element); return { connect() {} }; }
    createGain() {
      const gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } };
      gains.set(this.element, gain);
      return { gain, connect() {} };
    }
    async resume() { this.state = 'running'; }
  }
  class Document {
    currentScript = { dataset: { ktv420WorkletUrl: 'worklet.js' } };
    querySelectorAll(selector) {
      if (selector === 'audio, video') return elements;
      return timeline ? [{ max: timeline.duration * 1000, value: 5000,
        getAttribute: () => timeline.clock }] : [];
    }
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
  if (activate) commandListener({ source: window, data: { source: 'ktv420_content', commandId: 0,
    command: 'listening-enable', payload: { enabled: true } } });
  return { elements, graphs, gains, async command(command, payload = {}) {
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

test('ordinary Spotify playback stays untouched until explicit activation and is restored on release', async () => {
  const h = harness([{ src: 'song', _volume: 0.42, _muted: false }], undefined, null, false);
  const song = h.elements[0];
  await song.play();
  await h.command('listening-state');
  assert.deepEqual(h.graphs, [], 'passive tracking must not attach audio processing');
  assert.equal(song._volume, 0.42);
  assert.equal(Object.hasOwn(song, 'volume'), false, 'no volume override before activation');
  assert.equal((await h.command('capture-begin')).ok, false);
  assert.equal((await h.command('listening-output', { gain: 0 })).ok, false);
  assert.equal((await h.command('listening-rate', { rate: 1.2 })).ok, false);
  await h.command('listening-enable', { enabled: true });
  await h.command('capture-begin');
  song.volume = 0.6;
  await h.command('listening-rate', { rate: 1.2 });
  await h.command('listening-enable', { enabled: false });
  assert.equal(song._volume, 0.6, 'restore the current Spotify volume');
  assert.equal(song.playbackRate, 1);
  assert.equal(h.gains.get(song).value, 1, 'an existing graph becomes a normal passthrough');
  assert.equal((await h.command('capture-state')).ok, false);
  song.volume = 0.3; song.muted = true;
  assert.equal(song._volume, 0.3);
  assert.equal(song._muted, true);
  await song.play();
  assert.equal(h.graphs.length, 1);
  await h.command('listening-enable', { enabled: true });
  assert.equal(h.gains.get(song).value, 0, 'reopening waits for authorized monitoring');
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

test('closing during target discovery cannot start a late capture', async () => {
  const h = harness([{ src: 'previous' }, { src: 'current' }], elements => {
    void h.command('listening-enable', { enabled: false });
    elements[0].paused = true;
  });
  const result = await h.command('capture-begin', { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.match(result.error, /capture was closed/);
  assert.deepEqual(h.graphs, []);
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

test('song timeline excludes Spotify looping video from capture, tempo and monitoring', async () => {
  const h = harness([{ src: 'canvas', tagName: 'VIDEO', loop: true, duration: 7.799999, currentTime: 4.96 },
    { src: 'song', duration: 258.391, currentTime: 2.2 }], undefined, { duration: 258.391, clock: '0:02/4:18' });
  // Both play hooks create audio graphs. Only the song graph may be audible.
  await Promise.all(h.elements.map(element => element.play()));
  assert.equal((await h.command('listening-state')).result.media.source, 'song');
  assert.equal((await h.command('capture-begin')).result.target.source, 'song');
  assert.equal((await h.command('listening-rate', { rate: 1.25 })).ok, true);
  assert.equal(h.elements[0].playbackRate, 1);
  assert.equal(h.elements[1].playbackRate, 1.25);
  await h.command('listening-output', { gain: 0.7 });
  assert.equal(h.gains.get(h.elements[0]).value, 0);
  assert.equal(h.gains.get(h.elements[1]).value, 0.7);
  await h.command('listening-output', { gain: 0 });
  assert.equal(h.gains.get(h.elements[1]).value, 0);
});

test('playing decoration cannot displace a paused song or become the only capture target', async () => {
  const h = harness([{ src: 'canvas', tagName: 'VIDEO', loop: true, duration: 8 },
    { src: 'song', duration: 258.4, paused: true }], undefined, { duration: 258.391, clock: '0:00/4:18' });
  assert.equal((await h.command('capture-begin')).result.target.source, 'song');
  h.elements[1].ended = true;
  assert.equal((await h.command('listening-state')).result.media, null);
  assert.equal((await h.command('capture-begin', { timeoutMs: 100 })).ok, false);
});

test('equal-duration media use the accessible song clock, never the rounded range value', async () => {
  const h = harness([{ src: 'stale', currentTime: 5 }, { src: 'song', currentTime: 2.3 }],
    undefined, { duration: 180, clock: '0:02/3:00' });
  assert.equal((await h.command('capture-begin')).result.target.source, 'song');
  h.elements[0].currentTime = 2.3;
  assert.equal((await h.command('listening-state')).result.media, null, 'matching clocks still cannot justify an arbitrary pick');
  assert.equal((await h.command('capture-begin', { timeoutMs: 100 })).ok, false);
});

test('full music video is eligible when it matches the song, and a loop alone without controls is not', async () => {
  const h = harness([{ src: 'song-video', tagName: 'VIDEO', duration: 180 },
    { src: 'canvas', tagName: 'VIDEO', loop: true, duration: 8 }], undefined, { duration: 180, clock: '0:00/3:00' });
  assert.equal((await h.command('capture-begin')).result.target.source, 'song-video');
  const loop = harness([{ tagName: 'VIDEO', loop: true, duration: 8 }]);
  assert.equal((await loop.command('capture-begin', { timeoutMs: 100 })).ok, false);
});

test('capture waits for the song timeline to catch up during a transition', async () => {
  const timeline = { duration: 200, clock: '0:00/3:20' };
  const h = harness([{ src: 'next', duration: 180 }, { tagName: 'VIDEO', loop: true, duration: 8 }],
    () => { timeline.duration = 180; }, timeline);
  assert.equal((await h.command('capture-begin', { timeoutMs: 100 })).result.target.source, 'next');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const hookSource = readFileSync(new URL('../src/page/spotifyHooks.js', import.meta.url), 'utf8');

// Run the shipped page script through its real command bridge. Browser audio
// primitives are mocked, but source selection and capture lifecycle are not.
function harness(definitions, onWait = () => {}, timeline = null, activate = true, fetch = () => {}) {
  class Media {
    listeners = new Map();
    constructor(values) { Object.assign(this, { src: 'song', currentSrc: '', currentTime: 0, duration: 180,
      readyState: 4, playbackRate: 1, paused: false, ended: false, tagName: 'AUDIO', _volume: 1, _muted: false }, values); }
    get volume() { return this._volume; }
    set volume(value) { this._volume = value; }
    get muted() { return this._muted; }
    set muted(value) { this._muted = value; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type) { for (const listener of this.listeners.get(type) || []) listener(); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const elements = definitions.map(value => new Media(value));
  const graphs = [], ports = [], contexts = [];
  const gains = new Map();
  class AudioContext {
    constructor() { contexts.push(this); }
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
    fetch, setInterval() {},
    setTimeout(callback, delay) { now += delay; onWait(elements, now); callback(); },
    addEventListener(type, listener) { if (type === 'message') commandListener = listener; },
    postMessage(message) { if (message.event === 'command-result') reply = message.payload; },
  };
  const context = vm.createContext({ window, document: new Document(), Document, HTMLMediaElement: Media,
    XMLHttpRequest: XHR, navigator: {}, performance: { now: () => now }, setInterval() {},
    AudioWorkletNode: class { port = {}; constructor() { ports.push(this.port); this.port.postMessage = message => this.port.onmessage({data:{type:'flushed',id:message.id}}); } }, console, Uint8Array, ArrayBuffer, Headers });
  vm.runInContext(hookSource, context);
  if (activate) commandListener({ source: window, data: { source: 'ktv420_content', commandId: 0,
    command: 'listening-enable', payload: { enabled: true } } });
  return { fetch: (...args) => window.fetch(...args), elements, graphs, gains, ports, contexts, async command(command, payload = {}) {
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

test('accepting capture starts preserves status polling through finish, restart and abort', async () => {
  const h = harness([{ src: 'song' }]);
  async function checkStatus() {
    const state = await h.command('listening-state');
    assert.equal(state.ok, true, state.error);
    assert.equal(state.result.captureInvalid, false);
    assert.equal(state.result.captureEnded, false);
  }
  await checkStatus();
  assert.equal((await h.command('capture-begin')).ok, true);
  assert.equal((await h.command('capture-mark-start')).ok, true);
  await checkStatus();
  assert.equal((await h.command('capture-finish-and-begin')).ok, true);
  assert.equal((await h.command('capture-mark-start')).ok, true);
  await checkStatus();
  assert.equal((await h.command('capture-finish')).ok, true);
  await checkStatus();
  assert.equal((await h.command('capture-begin')).ok, true);
  assert.equal((await h.command('capture-mark-start')).ok, true);
  assert.equal((await h.command('capture-abort')).ok, true);
  await checkStatus();
  assert.equal((await h.command('capture-mark-start')).ok, false);
  await checkStatus();
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

test('completed capture retains its boundary after Spotify reuses the media element', async () => {
  const h = harness([{ src: 'first', duration: 180 }]);
  await h.command('capture-begin');
  await h.command('capture-mark-start');
  const song = h.elements[0];
  song.currentTime = 180; song.ended = true; song.paused = true;
  song.dispatch('ended');
  // The content-script poll can run after Spotify has already started another song.
  song.src = 'next'; song.duration = 220; song.currentTime = 0.2;
  song.ended = false; song.paused = false; song.dispatch('seeking');
  const state = (await h.command('capture-state')).result;
  assert.equal(state.source, 'first');
  assert.equal(state.currentTime, 180);
  assert.equal(state.duration, 180);
  assert.equal(state.ended, true);
  assert.equal((await h.command('listening-state')).result.captureInvalid, false);
  const next = await h.command('capture-finish-and-begin');
  assert.equal(next.result.finished.invalid, false);
  assert.equal(next.result.next.target.source, 'next');
  assert.equal((await h.command('capture-state')).result.ended, false);
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


test('verified capture arms while paused at zero and late metadata never discards its opening', async () => {
  const h=harness([{src:'song',paused:true,duration:1/44100}]);
  const begin=await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
  assert.equal(begin.ok,true);assert.equal(begin.result.startVerified,true);
  await h.elements[0].play();
  const bytes=new Uint8Array([1,2,3,4,5,6,7,8]);
  h.ports[0].onmessage({data:{bytesBuffer:bytes.buffer,channelCount:2,frame:0}});
  h.elements[0].currentTime=.4;
  h.contexts[0].currentTime=1/44100;
  await h.command('capture-mark-start');
  const result=(await h.command('capture-finish')).result;
  assert.deepEqual(new Uint8Array(result.bytesBuffer),bytes);
  assert.equal(result.startMediaTime,0);assert.equal(result.startVerified,true);
});

test('verified capture rejects a late, playing, seeking, or changed source at the final arm boundary', async () => {
  for(const values of [{currentTime:.1},{paused:false},{seeking:true},{src:'different'}]){
    const h=harness([{src:'song',paused:true,...values}]);
    const result=await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    assert.equal(result.ok,false);assert.match(result.error,/before recording was armed/);
  }
});

test('audio-clock intervals retain delayed pre-pause/tail samples and exclude paused/next-song blocks', async () => {
  const h=harness([{src:'song',paused:true,duration:4/44100}]);
  await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
  const element=h.elements[0],clock=h.contexts[0];
  await element.play();clock.currentTime=2/44100;element.pause();
  clock.currentTime=10/44100;await element.play();
  const block=(frame,values)=>h.ports[0].onmessage({data:{frame,channelCount:2,bytesBuffer:new Float32Array(values.flatMap(value=>[value,value])).buffer}});
  block(0,[1,2]); // delivered after resume, but produced before pause
  block(2,[0,0,0,0,0,0,0,0]);
  clock.currentTime=12/44100;element.ended=true;element.paused=true;element.dispatch('ended');
  block(10,[3,4]); // delivered after ended, still belongs to this capture
  element.src='next';element.dispatch('seeking');block(12,[99,99]);
  const result=(await h.command('capture-finish')).result;
  assert.equal(result.invalid,false);
  assert.deepEqual([...new Float32Array(result.bytesBuffer)],[1,1,2,2,3,3,4,4]);
});

test('verified finalization trims block padding only at the known tail and rejects missing frames', async () => {
  for(const count of [3,5]){
    const h=harness([{src:'song',paused:true,duration:4/44100}]);
    await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    await h.elements[0].play();h.contexts[0].currentTime=count/44100;
    h.ports[0].onmessage({data:{frame:0,channelCount:2,bytesBuffer:new Float32Array(count*2).buffer}});
    const result=(await h.command('capture-finish')).result;
    assert.equal(result.invalid,count<4);assert.equal(result.byteLength,Math.min(count,4)*8);
  }
});


test('playlist pagination retains absolute indices, unavailable gaps and repeated tracks', async () => {
  const id='1111111111111111111111', other='2222222222222222222222';
  const item=trackId=>({track:{id:trackId,name:'Song'}});
  const offsets=[];
  const h=harness([],undefined,null,false,async (_url,init)=>{
    const {offset}=JSON.parse(init.body).variables; offsets.push(offset);
    return new Response(JSON.stringify({data:{playlistV2:{content:{totalCount:4,items:offset===0 ? [item(id),{}] : [item(id),item(other)]}}}}));
  });
  await h.fetch('https://api-partner.spotify.com/pathfinder/v1/query',{method:'POST',body:JSON.stringify({operationName:'fetchPlaylistContents',variables:{uri:`spotify:playlist:${id}`,offset:0,limit:2}})});
  await new Promise(resolve=>setImmediate(resolve));
  const result=await h.command('playlist-tracks',{playlistUri:`spotify:playlist:${id}`});
  assert.equal(result.ok,true);
  assert.deepEqual(Array.from(result.result.tracks,t=>[t.trackId,t.rowIndex]),[[id,0],[id,2],[other,3]]);
  assert.deepEqual(offsets,[0,0,2]);
});


test('delayed ended event trims only proven digital silence and preserves the complete opening', async () => {
  const h=harness([{src:'song',paused:true,duration:4/44100}]);
  await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
  await h.elements[0].play();
  // Deliberate opening silence is part of the song, followed by its final samples.
  const signal=new Float32Array([0,0,0,0,.5,-.5,.25,-.25]);
  h.ports[0].onmessage({data:{frame:0,channelCount:2,bytesBuffer:signal.buffer}});
  const silentFrames=44100/2;
  h.contexts[0].currentTime=(4+silentFrames)/44100;
  h.elements[0].ended=true;h.elements[0].dispatch('ended');
  // Delivered after ended, but produced before the delayed event.
  h.ports[0].onmessage({data:{frame:4,channelCount:2,bytesBuffer:new Float32Array(silentFrames*2).buffer}});
  const result=(await h.command('capture-finish')).result;
  assert.equal(result.invalid,false);assert.equal(result.rawCapturedFrames,4+silentFrames);
  assert.deepEqual([...new Float32Array(result.bytesBuffer)],[...signal]);
});

test('signal beyond the natural-end bound, invalid samples, or an unconfirmed long tail cannot be trimmed', async () => {
  for (const {tail,ended} of [{tail:1e-20,ended:true},{tail:NaN,ended:true},{tail:0,ended:false}]) {
    const h=harness([{src:'song',paused:true,duration:4/44100}]);
    await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    await h.elements[0].play();
    const pcm=new Float32Array(10000);pcm[6000]=tail;
    h.contexts[0].currentTime=5000/44100;
    if(ended){h.elements[0].ended=true;h.elements[0].dispatch('ended');}
    h.ports[0].onmessage({data:{frame:0,channelCount:2,bytesBuffer:pcm.buffer}});
    const result=(await h.command('capture-finish')).result;
    assert.equal(result.invalid,true);assert.match(result.invalidReason,/unverified extra audio/);
  }
});

test('missing or repeated worklet blocks cannot be compensated by silent end padding', async () => {
  for (const frame of [0,2]) {
    const h=harness([{src:'song',paused:true,duration:4/44100}]);
    await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    await h.elements[0].play();
    const block=frame=>h.ports[0].onmessage({data:{frame,channelCount:2,bytesBuffer:new Float32Array(2).buffer}});
    block(0);block(frame);
    const result=(await h.command('capture-finish')).result;
    assert.equal(result.invalid,true);assert.match(result.invalidReason,/missed or repeated/);
  }
});

test('compressed duration overhang is accepted only after natural completion, without padding', async () => {
  for (const { short, ended, missingFirst, missingLast, changedSource, valid } of [
    { short: .025, ended: true, valid: true },
    { short: .025, ended: false },
    { short: .075, ended: true },
    { short: .025, ended: true, missingFirst: true },
    { short: .025, ended: true, missingLast: true },
    { short: .025, ended: true, changedSource: true },
  ]) {
    const h = harness([{ src: 'song', paused: true, duration: 3 }]);
    await h.command('capture-begin', { requireStart: true, expectedSource: 'song' });
    await h.elements[0].play();
    const frames = Math.round((3 - short) * 44100), offset = missingFirst ? 128 : 0;
    const pcm = new Float32Array((frames - offset - (missingLast ? 128 : 0)) * 2);
    pcm[pcm.length - 1] = .25; // the last audible sample must survive unchanged
    h.contexts[0].currentTime = frames / 44100;
    h.ports[0].onmessage({ data: { frame: offset, channelCount: 2, bytesBuffer: pcm.buffer } });
    if (changedSource) h.elements[0].src = 'next';
    if (ended) { h.elements[0].ended = true; h.elements[0].currentTime = 3; h.elements[0].dispatch('ended'); }
    const result = (await h.command('capture-finish')).result;
    assert.equal(result.invalid, !valid, JSON.stringify({short,ended,missingFirst,missingLast,changedSource}));
    assert.equal(result.endVerified, !!valid);
    if (valid) {
      assert.equal(result.byteLength, pcm.byteLength, 'never insert artificial tail samples');
      assert.deepEqual(new Float32Array(result.bytesBuffer), pcm);
    }
  }
});

test('final duration replaces the provisional duration and survives next-song reuse', async () => {
  const h = harness([{ src: 'song', paused: true, duration: 3 }]);
  await h.command('capture-begin', { requireStart: true, expectedSource: 'song' });
  await h.elements[0].play();
  const frames = 3 * 44100, pcm = new Float32Array(frames * 2);
  pcm[pcm.length - 1] = .4;
  h.contexts[0].currentTime = 3;
  h.ports[0].onmessage({ data: { frame: 0, channelCount: 2, bytesBuffer: pcm.buffer } });
  h.elements[0].duration = 3.025;
  h.elements[0].ended = true; h.elements[0].dispatch('ended');
  h.elements[0].src = 'next'; h.elements[0].duration = 200;
  const result = (await h.command('capture-finish')).result;
  assert.equal(result.invalid, false);
  assert.equal(result.endVerified, true);
  assert.equal(result.mediaDuration, 3.025);
  assert.deepEqual(new Float32Array(result.bytesBuffer), pcm);
});

test('a completely missing pre-pause interval cannot be mistaken for codec padding', async () => {
  const h = harness([{ src: 'song', paused: true, duration: 4 / 44100 }]);
  await h.command('capture-begin', { requireStart: true, expectedSource: 'song' });
  await h.elements[0].play();
  h.contexts[0].currentTime = 2 / 44100; h.elements[0].pause();
  h.contexts[0].currentTime = 10 / 44100; await h.elements[0].play();
  h.contexts[0].currentTime = 12 / 44100;
  h.elements[0].ended = true; h.elements[0].dispatch('ended');
  h.ports[0].onmessage({ data: { frame: 10, channelCount: 2, bytesBuffer: new Float32Array(4).buffer } });
  const result = (await h.command('capture-finish')).result;
  assert.equal(result.invalid, true);
  assert.equal(result.endVerified, false);
});

test('natural-end resampler tails survive; only subsequent exact silence is removed', async () => {
  for (const silentFrames of [0, 44100 / 2]) {
    const expected = 44100 * 3, tailFrames = Math.round(44100 * .021);
    const frames = expected + tailFrames + silentFrames;
    const h = harness([{src:'song',paused:true,duration:3}]);
    await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    await h.elements[0].play();
    const pcm = new Float32Array(frames * 2);
    pcm[0] = .25; // preserve the very first sample
    pcm[(expected + tailFrames) * 2 - 1] = 1e-20; // quiet right-channel tail
    h.contexts[0].currentTime = frames / 44100;
    h.elements[0].ended = true; h.elements[0].dispatch('ended');
    // Deliver in multiple blocks, with the expected end crossing a block.
    const split = (expected - 32) * 2;
    h.ports[0].onmessage({data:{frame:0,channelCount:2,bytesBuffer:pcm.slice(0,split).buffer}});
    h.ports[0].onmessage({data:{frame:split/2,channelCount:2,bytesBuffer:pcm.slice(split).buffer}});
    const capture = (await h.command('capture-finish')).result;
    assert.equal(capture.invalid,false);
    assert.equal(capture.endVerified,true);
    assert.equal(capture.rawCapturedFrames,frames);
    assert.deepEqual(new Float32Array(capture.bytesBuffer),pcm.slice(0,(expected+tailFrames)*2));
  }
});

test('a brief buffering stall cannot be accepted as a small resampler tail', async () => {
  const h = harness([{src:'song',paused:true,duration:3}]);
  await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
  await h.elements[0].play();
  h.elements[0].currentTime = 1; h.elements[0].readyState = 2;
  h.elements[0].dispatch('waiting');
  h.elements[0].readyState = 4;
  const frames = Math.round(44100 * 3.021);
  h.contexts[0].currentTime = frames / 44100;
  h.elements[0].ended = true; h.elements[0].dispatch('ended');
  h.ports[0].onmessage({data:{frame:0,channelCount:2,bytesBuffer:new Float32Array(frames*2).buffer}});
  const capture = (await h.command('capture-finish')).result;
  assert.equal(capture.invalid,true);
  assert.equal(capture.endVerified,false);
  assert.match(capture.invalidReason,/Spotify buffered/);
});

test('audio beyond the duration still requires natural completion and an intact stream', async () => {
  for (const issue of ['paused', 'source-change', 'missing-first']) {
    const h = harness([{src:'song',paused:true,duration:3}]);
    await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
    await h.elements[0].play();
    const frames = Math.round(44100 * 3.021), first = issue === 'missing-first' ? 128 : 0;
    const pcm = new Float32Array((frames-first)*2);pcm[pcm.length-1]=.25;
    h.contexts[0].currentTime=frames/44100;
    if(issue==='source-change')h.elements[0].src='next';
    if(issue!=='paused'){h.elements[0].ended=true;h.elements[0].dispatch('ended');}
    h.ports[0].onmessage({data:{frame:first,channelCount:2,bytesBuffer:pcm.buffer}});
    const capture=(await h.command('capture-finish')).result;
    assert.equal(capture.invalid,true,issue);
    assert.equal(capture.endVerified,false,issue);
  }
});

test('armed zero-position seek is harmless only before any playback and on the same source', async () => {
  const h = harness([{ src: 'song', paused: true, duration: 2 / 44100 }]);
  await h.command('capture-begin', { requireStart: true, expectedSource: 'song' });
  const song = h.elements[0];
  song.seeking = true; song.dispatch('seeking');
  assert.equal((await h.command('capture-state')).result.invalid, false);
  song.seeking = false;
  await song.play();
  const signal = new Float32Array([.5, -.5, .25, -.25]);
  h.ports[0].onmessage({ data: { frame: 0, channelCount: 2, bytesBuffer: signal.buffer } });
  h.contexts[0].currentTime = 2 / 44100;
  song.currentTime = song.duration; song.ended = true; song.dispatch('ended');
  const result = (await h.command('capture-finish')).result;
  assert.equal(result.invalid, false);
  assert.deepEqual([...new Float32Array(result.bytesBuffer)], [...signal]);
  assert.equal(result.endVerified, true);
});

test('actual seeks, unresolved startup seeks and later returns to zero remain invalid', async () => {
  for (const scenario of ['nonzero', 'source', 'unsettled', 'playing', 'paused-after-playing']) {
    const h = harness([{ src: 'song', paused: true }]);
    await h.command('capture-begin', { requireStart: true, expectedSource: 'song' });
    const song = h.elements[0];
    if (scenario === 'nonzero') song.currentTime = .001;
    if (scenario === 'source') song.src = 'replacement';
    if (scenario === 'playing' || scenario === 'paused-after-playing') {
      await song.play(); h.contexts[0].currentTime = 5;
      if (scenario === 'paused-after-playing') song.pause();
    }
    song.seeking = true; song.dispatch('seeking');
    if (scenario === 'unsettled') await song.play();
    const state = (await h.command('capture-state')).result;
    assert.equal(state.invalid, true, scenario);
    assert.match(state.invalidReason, /Spotify (changed position|moved before)/);
    if (scenario === 'playing') assert.match(state.invalidReason, /5\.000s after capture began/);
    const result = (await h.command('capture-finish')).result;
    assert.equal(result.invalid, true, scenario);
  }
});

test('exact capture rewind changes only a matching paused source before recording', async () => {
  const h=harness([{src:'song',paused:true,currentTime:2.824}]);
  const result=await h.command('capture-rewind',{expectedSource:'song'});
  assert.equal(result.ok,true);assert.equal(h.elements[0].currentTime,0);assert.equal(h.elements[0].paused,true);
  await h.command('capture-begin',{requireStart:true,expectedSource:'song'});
  assert.equal((await h.command('capture-rewind',{expectedSource:'song'})).ok,false,'never seek an active recording');
  for(const values of [{paused:false},{seeking:true},{src:'other'}]){
    const other=harness([{src:'song',paused:true,currentTime:2.824,...values}]);
    assert.equal((await other.command('capture-rewind',{expectedSource:'song'})).ok,false);
    assert.equal(other.elements[0].currentTime,2.824);
  }
  const closed=harness([{src:'song',paused:true,currentTime:2.824}],undefined,null,false);
  assert.equal((await closed.command('capture-rewind',{expectedSource:'song'})).ok,false);
  assert.equal(closed.elements[0].currentTime,2.824);
});

test('capture preparation pauses actual audio even when the UI pause has not reached it', async () => {
  const h=harness([{src:'song',paused:false,currentTime:2.824}]);
  const result=await h.command('capture-prepare');
  assert.equal(result.ok,true);assert.equal(result.result.target.paused,true);
  assert.equal(h.elements[0].paused,true);assert.equal(h.elements[0].currentTime,2.824);
  assert.equal((await h.command('capture-rewind',{expectedSource:'song'})).ok,true);
  assert.equal(h.elements[0].currentTime,0);
});

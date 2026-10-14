import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountButton } from '../src/content/ui.js';

test('overlay waits for a trusted ready message, then sends cloneable DOM track metadata', async t => {
  const elements = [];
  const messages = [];
  const timers = [];
  const listeners = {};
  let pendingReply;const captureRequests=[],transportRequests=[],replayModes=[];
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
    chrome: { runtime: { sendMessage(_message, respond) { pendingReply=respond;respond({ok:true,result:null}); }, getManifest: () => ({ version: '0.5.0' }), getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener() {}, removeListener() {} } } },
    setInterval: callback => { timers.push(callback); return 1; },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const ui = mountButton({ isRunActive: () => false, onToggleRun: async options => {captureRequests.push(options);}, loadSpotifyTracks: async () => [], onTransport: async command => {transportRequests.push(command);}, onReplay: enabled => replayModes.push(enabled) });
  elements.find(element => element.id === 'ktv420-spotify-capture-button').onclick();
  await new Promise(resolve => setImmediate(resolve));
  const frame = elements.find(element => element.tag === 'iframe');
  frame.listeners.load?.();
  ui.refresh();
  timers[0]();
  assert.equal(messages.length, 0, 'loading/about:blank frames must receive no state messages');
  const ready = { source: frame.contentWindow, origin: 'chrome-extension://test', data: { source: 'ktv420-overlay', version: 2, type: 'ready' } };
  await listeners.message({ ...ready, origin: 'https://open.spotify.com' });
  await listeners.message({ ...ready, source: {} });
  await listeners.message({ ...ready, data: { source: 'untrusted', type: 'ready' } });
  await listeners.message({ ...ready, data: { ...ready.data, version: 1 } });
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
  assert.equal(messages.at(-1).captureProgress, null);
  ui.notifyCaptureProgress({ trackId, fraction: 0.4 });
  assert.deepEqual(messages.at(-1).captureProgress, { trackId, fraction: 0.4 });
  ui.notifyCaptureProgress(null);
  assert.equal(messages.at(-1).captureProgress, null);
  pendingReply({ok:true,result:{tracks:[{id:trackId,title:'Common Enemy'}]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(replayModes,[true],'imported recording arms silent preparation');
  assert.equal(messages.some(message=>message.type==='replay'),true);
  await listeners.message({...ready,data:{...ready.data,type:'toggle-capture'}});
  assert.deepEqual(captureRequests.at(-1).trackIds,[trackId],'capture only songs required by this recording');
  assert.deepEqual(transportRequests.at(-1),{action:'volume',volume:0},'capture begins silently without changing its PCM samples');
  const overlay=elements.find(element=>element.id==='ktv420-prepared-iframe');
  const escape={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){}};
  listeners.keydown(escape);
  assert.equal(escape.prevented,true);
  assert.equal(overlay.dataset.open,'false');
  assert.deepEqual(transportRequests.at(-1),{action:'pause'});
  assert.equal(messages.at(-1).type,'closed','the hosted player must cancel pending replay too');
  const count=transportRequests.length;
  listeners.keydown({key:'Escape',preventDefault(){throw Error('closed overlay consumed Escape');},stopPropagation(){}});
  assert.equal(transportRequests.length,count,'Escape outside the overlay does not pause Spotify');
  elements.find(element=>element.id==='ktv420-spotify-capture-button').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  await listeners.message({...ready,data:{...ready.data,type:'close'}});
  assert.equal(overlay.dataset.open,'false');
  assert.deepEqual(transportRequests.at(-1),{action:'pause'},'close button has the same pause behavior');
});

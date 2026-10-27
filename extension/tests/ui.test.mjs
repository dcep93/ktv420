import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountButton } from '../src/content/ui.js';

test('overlay waits for a trusted ready message, then sends cloneable DOM track metadata', async t => {
  const registrations = [];
  let holdRegistration = false; const registrationReplies = [];
  const elements = [];
  const messages = [];
  const timers = [];
  const animationFrames = [];
  let domChanged, disconnected = false;
  const listeners = {};
  let resolveTracks; const trackLoad = new Promise(resolve => { resolveTracks = resolve; });
  let pendingReply;const captureRequests=[],transportRequests=[],replayModes=[];
  const trackId = '5EGTNEoUpibGgMWf6ECe0X';
  let rowsAvailable = true, runActive = false;
  let visibleRows;
  const row = {
    querySelector: () => ({ getAttribute: () => `/track/${trackId}`, textContent: 'Common Enemy' }),
    querySelectorAll: () => [],
  };
  visibleRows = [row];
  // Like an HTMLDivElement, this row cannot cross postMessage's clone boundary.
  assert.throws(() => structuredClone(row), { name: 'DataCloneError' });
  const makeElement = tag => {
    const element = { tag, dataset: {}, style: {}, children: [], listeners: {},
      setAttribute() {}, remove() { this.isConnected = false; }, hasAttribute(name) { return name === 'srcdoc' && this.srcdoc !== undefined; },
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
  const pageLocation = new URL('https://open.spotify.com/playlist/1111111111111111111111');
  const globals = {
    document: {
      getElementById: () => null,
      createElement: makeElement,
      documentElement: makeElement('html'), body: makeElement('body'),
      querySelector: selector => selector.includes('logoSpotify')
        ? { closest: () => ({ parentElement: parent }) }
        : selector.includes('entity-header') ? null : { querySelectorAll: () => rowsAvailable ? visibleRows : [] },
    },
    window: { location: pageLocation,
      addEventListener(name, listener) { listeners[name] = listener; }, removeEventListener() {} },
    location: pageLocation,
    history: { state: { spotify: true }, pushState(state, _title, href) { assert.deepEqual(state, {spotify:true}); pageLocation.href = href; }, replaceState(state, title, href) { this.pushState(state, title, href); } },
    chrome: { runtime: { id: 'test', sendMessage(message, respond) { if (message.type === 'ktv420:register-collection') { registrations.push(message); if (holdRegistration) { registrationReplies.push(respond); return; } } if (message.type === 'ktv420:pending-replay') pendingReply=respond; respond({ok:true,result:null}); }, getManifest: () => ({ version: '0.5.0' }), getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener() {}, removeListener() {} } } },
    setInterval: callback => { timers.push(callback); return 1; },
    clearInterval() {},
    MutationObserver: class {
      constructor(callback) { domChanged = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame(callback) { animationFrames.push(callback); return animationFrames.length; },
    cancelAnimationFrame() {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const ui = mountButton({ isRunActive: () => runActive, onToggleRun: async options => {captureRequests.push(options);}, loadSpotifyTracks: () => trackLoad, onTransport: async command => {transportRequests.push(command);}, onReplay: enabled => replayModes.push(enabled) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.some(element => element.tag === 'iframe'), false, 'ordinary Spotify loads do not load or activate the player');
  pageLocation.search = '?ktv420=1'; listeners.popstate();
  assert.notEqual(elements.find(element => element.id === 'ktv420-prepared-iframe').dataset.open, 'true', 'deep link waits while Spotify tracks load');
  assert.equal(transportRequests.length, 0, 'waiting must not take over playback');
  assert.equal(elements.some(element => element.tag === 'iframe'), true, 'requested player loads in parallel with unresolved Spotify metadata');
  const earlyFrame = elements.find(element => element.tag === 'iframe');
  const earlyReady = { source: earlyFrame.contentWindow, origin: 'chrome-extension://test',
    data: { source: 'ktv420-overlay', version: 2, type: 'ready' } };
  await listeners.message(earlyReady);
  const emptyState = messages.at(-1);
  assert.deepEqual(emptyState.tracks, []);
  await listeners.message({ ...earlyReady, data: { ...earlyReady.data, type: 'view-ready',
    spotifyPath: emptyState.spotifyPath, revision: emptyState.navigation.revision } });
  assert.equal(transportRequests.length, 0, 'preloaded player cannot activate Spotify before tracks arrive');
  assert.notEqual(elements.find(element => element.id === 'ktv420-prepared-iframe').dataset.open, 'true');
  earlyFrame.contentDocument = { URL: 'about:blank' }; ui.notifyListening(null);
  earlyFrame.contentDocument = null; messages.length = 0;
  resolveTracks([]);
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
  assert.notEqual(elements.find(element => element.id === 'ktv420-prepared-iframe').dataset.open, 'true', 'broker readiness alone must not show an empty player');
  async function renderView(overrides = {}) {
    const state = messages.filter(message => message.type === 'state').at(-1);
    await listeners.message({ ...ready, data: { ...ready.data, type: 'view-ready', spotifyPath: state.spotifyPath, revision: state.navigation.revision, ...overrides } });
  }
  await renderView({revision:999});
  await renderView({spotifyPath:'album/wrong'});
  assert.equal(transportRequests.length, 0, 'stale or mismatched render cannot activate audio');
  await renderView();
  assert.equal(elements.find(element => element.id === 'ktv420-prepared-iframe').dataset.open, 'true', 'matching rendered playlist opens the requested view');
  assert.deepEqual(transportRequests.at(-1), {action:'pause',bestEffort:true});
  ui.refresh();
  timers[0]();
  assert.ok(messages.length > 0);
  for (const message of messages.filter(message => message.tracks.length)) {
    assert.equal(message.supported, true);
    assert.deepEqual(message.tracks, [{ trackId, trackName: 'Common Enemy', trackArtist: '', trackArtworkSrc: '', rowIndex: 0 }]);
  }
  assert.equal(messages.at(-1).tracks.length, 1);
  assert.equal(messages.at(-1).captureProgress, null);
  assert.equal(registrations.some(item => item.started), false, 'opening alone does not start a catalog entry');
  ui.notifyListening({ capturing: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registrations.at(-1).started, true, 'passive capture registers before any song is saved');
  const registrationsAtStart = registrations.length;
  ui.notifyListening({ capturing: true });
  assert.equal(registrations.length, registrationsAtStart, 'capture heartbeats do not repeatedly write the catalog');
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
  await renderView();
  await listeners.message({...ready,data:{...ready.data,type:'close'}});
  assert.equal(overlay.dataset.open,'false');
  assert.deepEqual(transportRequests.at(-1),{action:'pause'},'close button has the same pause behavior');

  pageLocation.search = '?si=keep&ktv420=1';
  listeners.popstate();
  await new Promise(resolve=>setImmediate(resolve));
  await renderView();
  assert.equal(overlay.dataset.open, 'true');
  assert.equal(messages.at(-1).navigation.trackIndex, 1);
  assert.deepEqual(transportRequests.at(-1), {action:'pause',bestEffort:true}, 'a deep link requests pause before the hosted app loads');
  const revision = messages.at(-1).navigation.revision;
  await listeners.message({...ready,data:{...ready.data,type:'view',trackIndex:null,revision,replace:false}});
  assert.equal(pageLocation.search, '?si=keep&ktv420');
  await listeners.message({...ready,data:{...ready.data,type:'view',trackIndex:1,revision:revision-1}});
  assert.equal(pageLocation.search, '?si=keep&ktv420', 'stale navigation must not overwrite Back/Forward');
  pageLocation.search = '?si=keep'; listeners.popstate();
  assert.equal(overlay.dataset.open, 'false');
  pageLocation.search = '?si=keep&ktv420=1'; listeners.popstate();
  await new Promise(resolve=>setImmediate(resolve));
  await renderView();
  assert.equal(overlay.dataset.open, 'true');
  await listeners.message({...ready,data:{...ready.data,type:'close'}});
  assert.equal(pageLocation.search, '?si=keep');

  pageLocation.search = '?ktv420'; listeners.popstate();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(overlay.dataset.open, 'false');
  listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  await renderView();
  assert.equal(overlay.dataset.open,'false','Escape cancels pending opening as well as visible overlays');
  pageLocation.pathname = '/'; pageLocation.search = ''; ui.refresh();
  elements.find(element=>element.id==='ktv420-spotify-capture-button').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(overlay.dataset.open,'false','unsupported Spotify pages cannot open the overlay');
  assert.equal(pageLocation.search,'');
  pageLocation.pathname = '/playlist/1111111111111111111111'; ui.refresh();

  rowsAvailable = false;
  pageLocation.pathname = '/album/2222222222222222222222'; pageLocation.search = '?ktv420';
  listeners.popstate(); await new Promise(resolve=>setImmediate(resolve));
  await renderView();
  assert.equal(overlay.dataset.open,'false','empty Spotify rows keep the requested overlay hidden');
  rowsAvailable = true;
  const scheduled = animationFrames.length;
  domChanged(); domChanged(); domChanged();
  assert.equal(animationFrames.length, scheduled + 1, 'Spotify DOM bursts schedule one refresh');
  animationFrames.at(-1)();
  await new Promise(resolve=>setImmediate(resolve)); await renderView();
  assert.equal(overlay.dataset.open,'true','arriving rows open the overlay without waiting for the one-second poll');
  // Spotify initially renders a partial album, then appends the remaining rows.
  const albumRows = Array.from({length: 11}, (_, index) => ({
    getAttribute: name => name === 'aria-rowindex' ? String(index + 2) : null,
    querySelector: () => ({getAttribute: () => `/track/${String(index).padStart(22, '0')}`, textContent: `Song ${index + 1}`}),
    querySelectorAll: () => [],
  }));
  visibleRows = albumRows.slice(0, 9); timers[0]();
  runActive = true;
  visibleRows = albumRows; timers[0]();
  assert.equal(messages.at(-1).tracks.length, 11, 'late rows join an open overlay even during capture');
  assert.equal(messages.at(-1).tracks.at(-1).trackName, 'Song 11');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registrations.at(-1).collection.trackIds.length, 11, 'catalog receives the expanded collection');
  visibleRows = albumRows.slice(9); timers[0]();
  assert.equal(messages.at(-1).tracks.length, 11, 'virtualized rows must not erase earlier songs');
  runActive = false;
  pageLocation.pathname = '/album/3333333333333333333333';
  visibleRows = [row]; ui.refresh();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.at(-1).tracks.length, 1, 'a new album must not inherit previous rows');

  await renderView();
  for (const cancel of ['capture-cancel', 'close']) {
    holdRegistration = true;
    const beforeCapture = captureRequests.length;
    const captureStart = listeners.message({...ready,data:{...ready.data,type:'capture-one',id:'held-request',trackId}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(captureRequests.length, beforeCapture, 'capture must wait for catalog/context acknowledgement');
    if (cancel === 'close') listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
    else await listeners.message({...ready,data:{...ready.data,type:cancel,id:'held-request'}});
    holdRegistration = false;
    for (const respond of registrationReplies.splice(0)) respond({ok:true,result:null});
    await captureStart;
    assert.equal(captureRequests.length, beforeCapture, `${cancel} during registration must not start capture later`);
  }

  await listeners.message({...ready,data:{...ready.data,type:'close'}});

  for (const invalidate of [
    () => { frame.srcdoc = '<p>replaced frame</p>'; },
    () => { frame.contentDocument = { URL: 'about:blank' }; },
    () => { frame.src = 'https://open.spotify.com/'; },
    () => { chrome.runtime.id = undefined; },
  ]) {
    const before = messages.length;
    invalidate();
    frame.listeners.load?.();
    await listeners.message(ready); // A queued ready from the old document.
    ui.notifyListening(null);
    listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
    assert.equal(messages.length, before, 'state, replay and close must not target a replaced frame');
    delete frame.srcdoc; frame.contentDocument = null;
    frame.src = 'chrome-extension://test/build/index.html?overlay=1'; chrome.runtime.id = 'test';
    ui.refresh();
    assert.equal(messages.length, before, 'restored broker must handshake again');
    await listeners.message(ready);
    assert.ok(messages.length > before, 'fresh trusted handshake restores delivery');
  }

  // Repair the exact blank-frame failure without stopping the current capture.
  overlay.dataset.open = 'true';
  for (const corrupt of [node => { node.srcdoc = ''; }, node => { node.src = 'https://open.spotify.com/'; }, node => { node.isConnected = false; }]) {
    const old = elements.filter(element => element.tag === 'iframe').at(-1);
    const before = messages.length, commandsBefore = transportRequests.length;
    corrupt(old);
    timers[0]();
    const replacement = elements.filter(element => element.tag === 'iframe').at(-1);
    assert.notEqual(replacement, old);
    assert.equal(old.isConnected, false);
    assert.equal(replacement.hasAttribute('srcdoc'), false);
    assert.equal(replacement.src, 'chrome-extension://test/build/index.html?overlay=1');
    assert.equal(messages.length, before, 'new frame must handshake before receiving state');
    await listeners.message({ ...ready, source: old.contentWindow });
    assert.equal(messages.length, before, 'old document cannot authenticate its replacement');
    replacement.contentDocument = { URL: 'about:blank' };
    timers[0](); ui.prepare();
    assert.equal(elements.filter(element => element.tag === 'iframe').at(-1), replacement, 'normal loading must not cause a restart loop');
    replacement.contentDocument = null;
    await listeners.message({ ...ready, source: replacement.contentWindow });
    assert.ok(messages.length > before, 'new trusted broker restores the overlay');
    assert.equal(transportRequests.length, commandsBefore, 'repair must not stop capture or change volume');
  }

  listeners.pagehide();
  assert.equal(disconnected, true, 'page teardown disconnects the DOM observer');

});

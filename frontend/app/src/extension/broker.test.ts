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
  const state = { source: 'ktv420-parent', version: 2, type: 'state', tracks: [], tracksComplete: false, active: false, starting: false, supported: true };
  await bridge.receive({ source: parent, origin: 'https://evil.example', data: state });
  await bridge.receive({ source: parent, origin: 'https://open.spotify.com', data: state });
  assert.equal(playerMessages.length, 0);
  await fromPlayer(command); assert.equal(parentMessages.length, 1); assert.equal(playerMessages.length, 1);
  assert.equal((parentMessages[0] as { version: number }).version, 2);
  assert.equal((playerMessages[0] as { version: number }).version, 2);
  assert.equal((playerMessages[0] as { tracksComplete: boolean }).tracksComplete, false, 'partial discovery reaches the hosted capture gate');
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
  await send({ trackId: 'actual-track', fraction: .99, phase: 'saving', extra: true });
  assert.deepEqual(messages.at(-1)!.captureProgress, { trackId: 'actual-track', fraction: .99, phase: 'saving' });
  await send(null);
  assert.equal(messages.at(-1)!.captureProgress, null);
  const count = messages.length;
  for (const invalid of [{ trackId: 'track', fraction: .99, phase: 'invented' }, [], '0.5', {}, { trackId: '', fraction: 0 }, { trackId: 1, fraction: 0 },
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

test('replay handoff waits for the hosted peer, survives reload, and rejects untrusted or malformed instructions', async () => {
  const messages: Record<string,unknown>[] = [], errors:string[]=[];
  const parent={postMessage(){}} as unknown as Window;
  const player={postMessage:(data:Record<string,unknown>)=>messages.push(data)} as unknown as Window;
  const bridge=createBrokerBridge({parent,player,parentOrigin:'https://open.spotify.com',playerOrigin:'https://ktv420.web.app',showError:e=>errors.push(e),
    createSession:()=>({dispose:async()=>{},handle:async()=>({source:'ktv420-library',version:2,id:'test',ok:true})}) as ReturnType<typeof createLibraryBrokerSession>});
  const id='1111111111111111111111';
  const recording={version:2,name:'Mix',createdAt:'2026-10-14',spotifyPath:`playlist/${id}`,tracks:[{id,title:'Song',duration:12}],events:[
    {type:'track',at:0,position:0,trackId:id,snapshot:{visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]}},
    {type:'stop',at:1,position:1,trackId:id}]};
  const data={source:'ktv420-parent',version:2,type:'replay',recording};
  await bridge.receive({source:parent,origin:'https://evil.example',data});
  await bridge.receive({source:player,origin:'https://open.spotify.com',data});assert.equal(messages.length,0);
  await bridge.receive({source:parent,origin:'https://open.spotify.com',data});assert.equal(messages.length,0);
  const ready={source:player,origin:'https://ktv420.web.app',data:{source:'ktv420-overlay',version:2,type:'ready'}};
  await bridge.receive(ready);assert.deepEqual(messages.at(-1)?.recording,recording);
  await bridge.reload();await bridge.reload();await bridge.receive(ready);assert.deepEqual(messages.at(-1)?.recording,recording);
  await bridge.receive({source:parent,origin:'https://open.spotify.com',data:{...data,recording:{version:1}}});assert.equal(errors.length,1);
  await bridge.receive({source:parent,origin:'https://open.spotify.com',data:{...data,recording:null}});assert.equal(messages.at(-1)?.recording,null);
  await bridge.dispose();
});


test('close notification reaches only the ready hosted player from the trusted Spotify parent', async () => {
  const messages: unknown[] = [];
  const parent = { postMessage() {} } as unknown as Window;
  const player = { postMessage: (data: unknown) => messages.push(data) } as unknown as Window;
  const bridge = createBrokerBridge({ parent, player, parentOrigin:'https://open.spotify.com', playerOrigin:'https://ktv420.web.app', showError() {},
    createSession: () => ({dispose:async () => {},handle:async () => ({source:'ktv420-library',version:2,id:'close-test',ok:true})}) as ReturnType<typeof createLibraryBrokerSession> });
  const closed={source:'ktv420-parent',version:2,type:'closed'};
  const send=(data=closed,source=parent,origin='https://open.spotify.com')=>bridge.receive({data,source,origin});
  await send(); assert.equal(messages.length,0);
  await bridge.receive({source:player,origin:'https://ktv420.web.app',data:{source:'ktv420-overlay',version:2,type:'ready'}});
  await send(closed,player); await send(closed,parent,'https://evil.example'); await send({...closed,version:1});
  assert.equal(messages.length,0);
  await send(); assert.deepEqual(messages,[closed]);
  await bridge.dispose();
});

test('URL view changes are sanitized, revisioned and restricted to the ready trusted player', async () => {
  const sent: Record<string,unknown>[] = [], received: Record<string,unknown>[] = [];
  const parent = {postMessage:(v:Record<string,unknown>)=>sent.push(v)} as unknown as Window;
  const player = {postMessage:(v:Record<string,unknown>)=>received.push(v)} as unknown as Window;
  const bridge = createBrokerBridge({parent,player,parentOrigin:'https://open.spotify.com',playerOrigin:'https://ktv420.web.app',showError(){},
    createSession:()=>({dispose:async()=>{},handle:async()=>({})}) as unknown as ReturnType<typeof createLibraryBrokerSession>});
  const command = {source:'ktv420-overlay',version:2,type:'view',trackIndex:3,revision:7,replace:true,evil:'discard'};
  const send = (data:unknown,source=player,origin='https://ktv420.web.app')=>bridge.receive({source,origin,data});
  await send(command); assert.equal(sent.length,0);
  await send({...command,type:'ready'});
  await send(command);
  assert.deepEqual(sent.at(-1),{source:'ktv420-overlay',version:2,type:'view',trackIndex:3,revision:7,replace:true});
  const count=sent.length;
  for (const index of [-1,0,10001,'1',Infinity]) await send({...command,trackIndex:index});
  await send(command,parent); await send(command,player,'https://evil.example');
  assert.equal(sent.length,count);
  await bridge.receive({source:parent,origin:'https://open.spotify.com',data:{source:'ktv420-parent',version:2,type:'state',tracks:[],active:false,starting:false,supported:true,
    navigation:{revision:7,open:true,trackIndex:3,evil:'discard'}}});
  assert.deepEqual(received.at(-1)?.navigation,{revision:7,open:true,trackIndex:3});
  await bridge.dispose();
});


test('render readiness only relays for the current populated collection and navigation revision', async () => {
  const sent: Record<string,unknown>[] = [];
  const parent={postMessage:(v:Record<string,unknown>)=>sent.push(v)} as unknown as Window;
  const player={postMessage(){}} as unknown as Window;
  const bridge=createBrokerBridge({parent,player,parentOrigin:'https://open.spotify.com',playerOrigin:'https://ktv420.web.app',showError(){},
    createSession:()=>({dispose:async()=>{},handle:async()=>({})}) as unknown as ReturnType<typeof createLibraryBrokerSession>});
  const spotifyPath='album/1111111111111111111111';
  const rendered={source:'ktv420-overlay',version:2,type:'view-ready',spotifyPath,revision:2};
  const send=(data:unknown,source=player,origin='https://ktv420.web.app')=>bridge.receive({source,origin,data});
  await send(rendered);assert.equal(sent.length,0);
  await send({...rendered,type:'ready'});sent.length=0;
  const state={source:'ktv420-parent',version:2,type:'state',active:false,starting:false,supported:true,spotifyPath,
    navigation:{open:true,revision:2,trackIndex:null},tracks:[{trackId:'song',trackName:'Song',rowIndex:0}]};
  await send({...state,tracks:[]},parent,'https://open.spotify.com');
  await send(rendered);assert.equal(sent.length,0,'empty collection is not ready');
  await send(state,parent,'https://open.spotify.com');
  await send({...rendered,revision:1});await send({...rendered,spotifyPath:'album/2222222222222222222222'});
  await send(rendered,parent);await send(rendered,player,'https://evil.example');
  assert.equal(sent.length,0);
  await send({...rendered,extra:'discard'});assert.deepEqual(sent,[rendered]);
  await send({...state,navigation:{...state.navigation,open:false}},parent,'https://open.spotify.com');
  await send(rendered);assert.equal(sent.length,1,'late readiness cannot reopen a closed view');
  await bridge.dispose();
});

test('single-song capture RPC is bounded, authenticated and reports sanitized results', async () => {
  const sent:Record<string,unknown>[]=[], replies:Record<string,unknown>[]=[];
  const parent={postMessage:(v:Record<string,unknown>)=>sent.push(v)} as unknown as Window;
  const player={postMessage:(v:Record<string,unknown>)=>replies.push(v)} as unknown as Window;
  const bridge=createBrokerBridge({parent,player,parentOrigin:'https://open.spotify.com',playerOrigin:'https://ktv420.web.app',showError(){},
    createSession:()=>({dispose:async()=>{},handle:async()=>({source:'ktv420-library',version:2,id:'x',ok:true})}) as ReturnType<typeof createLibraryBrokerSession>});
  const request={source:'ktv420-overlay',version:2,type:'capture-one',id:'request-1',trackId:'1111111111111111111111'};
  const send=(data:unknown,origin='https://ktv420.web.app')=>bridge.receive({data,origin,source:player});
  await send(request);assert.equal(sent.length,0);
  await send({source:'ktv420-overlay',version:2,type:'ready',controller:'hosted'});
  assert.equal(sent.at(-1)?.controller,'hosted');
  for(const data of [{...request,trackId:'bad'}, {...request,id:'x'.repeat(81)}, {...request,version:1}])await send(data);
  await send(request,'https://evil.example');assert.equal(sent.length,1);
  await send({...request,script:'discard'});assert.deepEqual(sent.at(-1),request);
  await send({...request,type:'capture-cancel'});assert.equal(sent.at(-1)?.type,'capture-cancel');
  await bridge.receive({source:parent,origin:'https://open.spotify.com',data:{source:'ktv420-parent',version:2,type:'capture-result',id:request.id,ok:false,error:'Stopped',extra:'discard'}});
  assert.deepEqual(replies.at(-1),{source:'ktv420-parent',version:2,type:'capture-result',id:request.id,ok:false,error:'Stopped'});
  await bridge.dispose();
});

test('standalone bridge allows local audio and navigation but blocks capture and all Spotify control', async () => {
  const sent: Record<string,unknown>[] = [], replies:unknown[]=[];
  const parent={postMessage:(value:Record<string,unknown>,origin:string)=>{assert.equal(origin,'https://ktv420.web.app');sent.push(value);}} as unknown as Window;
  const player={postMessage:(value:unknown)=>replies.push(value)} as unknown as Window;
  let calls=0;
  const bridge=createBrokerBridge({parent,player,parentOrigin:'https://ktv420.web.app',playerOrigin:'https://ktv420.web.app',standalone:true,showError(){},
    createSession:()=>({dispose:async()=>{},handle:async()=>{calls++;return {source:'ktv420-library',version:2,id:'read',ok:true};}}) as ReturnType<typeof createLibraryBrokerSession>});
  const send=(type:string,other={})=>bridge.receive({source:player,origin:'https://ktv420.web.app',data:{source:'ktv420-overlay',version:2,type,...other}});
  await send('ready');
  for(const type of ['capture-one','capture-cancel','toggle-capture','listening-heartbeat','transport']) await send(type,{id:'test',trackId:'1'.repeat(22),command:{action:'play'}});
  assert.deepEqual(sent.map(m=>m.type),['ready']);
  await send('view',{revision:1,trackIndex:2}); await send('close');
  assert.deepEqual(sent.map(m=>m.type),['ready','view','close']);
  await bridge.receive({source:parent,origin:'https://ktv420.web.app',data:{source:'ktv420-library',version:2,id:'read',method:'getPlaybackRecord',args:['one']}});
  assert.equal(calls,0,'parent webpage does not get direct library access');
  await bridge.receive({source:player,origin:'https://ktv420.web.app',data:{source:'ktv420-library',version:2,id:'read',method:'getPlaybackRecord',args:['one']}});
  assert.equal(calls,1); assert.equal(replies.length,1);
});

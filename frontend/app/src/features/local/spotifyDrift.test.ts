import test from 'node:test';
import assert from 'node:assert/strict';
import { SeekEcho, SpotifyDriftController, spotifySeekEcho, type NativePlayback } from './spotifyDrift';
import { SpotifyRemoteObserver } from './spotifySync';
import { parseTransportCommand, parseListeningState } from './listeningProtocol';
const native = (now=10000, patch:Partial<NativePlayback>={}) => ({trackId:'abc',position:40,duration:180,playing:true,local:true,observedAt:now,...patch});
const audio = (position=30) => ({trackId:'abc',position,duration:180,playing:true});
test('drift correction is one-way, bounded and acknowledged from native position', () => {
  const c = new SpotifyDriftController(new SeekEcho());
  assert.equal(c.tick(native(),audio(38),10000),null);
  assert.deepEqual(c.tick(native(),audio(),10000),{action:'seek',trackId:'abc',position:30,bestEffort:true,correction:true});
  assert.equal(c.tick(native(10500),audio(30.4),10500),null);
  assert.equal(c.tick(native(11000,{position:31}),audio(30.8),11000),null);
  assert.equal(c.tick(native(11500,{position:40}),audio(31),11500),null);
});
test('near-ending protection corrects a small lead before auto-advance', () => {
  assert.equal(new SpotifyDriftController(new SeekEcho()).tick(native(10000,{position:175}),audio(172),10000)?.action,'seek');
});
test('failed commands back off without queuing corrections', () => {
  const c = new SpotifyDriftController(new SeekEcho()); assert.ok(c.tick(native(),audio(),10000));
  for (let now=10500;now<=24500;now+=500) assert.equal(c.tick(native(now),audio(),now),null);
  assert.ok(c.tick(native(25000),audio(),25000));
});
test('capture, pause, track mismatch, stale and unavailable state never seek', () => {
  for (const patch of [{capturing:true},{playing:false},{trackId:'other'},{local:false},{error:'failed'},{observedAt:1000},{syncing:true}]) {
    assert.equal(new SpotifyDriftController().tick(native(10000,patch),audio(),10000),null);
  }
  assert.equal(new SpotifyDriftController().tick(native(),{...audio(),playing:false},10000),null);
});
test('fast tempo corrects forward without seeking to the native ending', () => {
  const command=new SpotifyDriftController().tick(native(10000,{position:170}),audio(179.9),10000);
  assert.equal(command?.action,'seek'); if(command?.action==='seek')assert.equal(command.position,179.5);
});
test('self-seek echo is ignored while concurrent pause and next remain observable', () => {
  spotifySeekEcho.clear(); const o = new SpotifyRemoteObserver(); o.observe(native(),10000);
  spotifySeekEcho.mark('abc',30,10000);
  assert.equal(o.observe(native(10200,{position:30.2,syncing:true}),10200),null);
  assert.deepEqual(o.observe(native(10400,{position:30.4,playing:false,syncing:true}),10400),{playing:false});
  assert.deepEqual(o.observe(native(10600,{trackId:'next',position:0}),10600),{trackId:'next',position:0,playing:true});
  spotifySeekEcho.clear();
});
test('remote seek elsewhere during a correction still reaches the player', () => {
  spotifySeekEcho.clear(); const o = new SpotifyRemoteObserver(); o.observe(native(),10000); spotifySeekEcho.mark('abc',30,10000);
  assert.deepEqual(o.observe(native(10200,{position:80}),10200),{position:80}); spotifySeekEcho.clear();
});
test('new correction is validated and old command shapes remain compatible', () => {
  assert.deepEqual(parseTransportCommand({action:'seek',trackId:'abc',position:3,correction:true}),{action:'seek',trackId:'abc',position:3,correction:true,bestEffort:true});
  assert.deepEqual(parseTransportCommand({action:'play',correction:true}),{action:'play'});
  assert.equal(parseTransportCommand({action:'hosted-control'}),null);
  const state={...native(),capability:1,generation:0,output:'stems',volume:.4,error:'',relayVersion:1,captureAllowed:false};
  assert.equal(parseListeningState(state)?.relayVersion,1);
  assert.equal(parseListeningState({...state,relayVersion:2})?.relayVersion,undefined);
});

test('a complete slowed track stays ahead of native auto-advance with sparse corrections',()=>{
  const c=new SpotifyDriftController(new SeekEcho());let nativeTime=0,seeks=0;
  for(let elapsed=.5;elapsed<225;elapsed+=.5){
    nativeTime+=.5;
    assert.ok(nativeTime<180,'native player must not reach the end first');
    const now=10000+elapsed*1000;
    const command=c.tick(native(now,{position:nativeTime}),audio(elapsed*.8),now);
    if(command?.action==='seek'){nativeTime=command.position;seeks++;}
  }
  assert.ok(seeks>0&&seeks<15,`corrections should be occasional, got ${seeks}`);
});

test('short songs and subtle slowdown retain the full audible tail',()=>{
  for(const duration of [2,8,30,180])for(const rate of [.5,.8,.95,1,1.5]){
    const c=new SpotifyDriftController(new SeekEcho());let position=0;
    for(let elapsed=.2;elapsed<duration/rate-.001;elapsed+=.2){
      position+=.2;const now=10000+elapsed*1000;
      assert.ok(position<duration+1e-6,`${duration}s at ${rate}x ended at ${elapsed}s`);
      const command=c.tick(native(now,{position,duration}),{...audio(elapsed*rate),duration},now);
      if(command?.action==='seek')position=command.position;
    }
  }
});

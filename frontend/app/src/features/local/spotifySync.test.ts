import test from 'node:test';
import assert from 'node:assert/strict';
import { bestEffortSpotify, SpotifyRemoteObserver, type RemotePlayback } from './spotifySync';
import { parseTransportCommand } from './listeningProtocol';
const state = (at: number, patch: Partial<RemotePlayback> = {}): RemotePlayback => ({
  trackId:'abc', observedAt:at, position:at/1000, playing:true, local:true, ...patch,
});
test('Spotify is not the local clock: drift needs no correction; remote edges still work', () => {
  const observer = new SpotifyRemoteObserver();
  assert.equal(observer.observe(state(10000),10000),null);
  for(let at=10200;at<20000;at+=200) assert.equal(observer.observe(state(at),at),null);
  assert.deepEqual(observer.observe(state(20000,{playing:false}),20000),{playing:false});
  assert.deepEqual(observer.observe(state(20200,{playing:false,position:40}),20200),{position:40});
  assert.deepEqual(observer.observe(state(20400,{playing:true,position:40}),20400),{playing:true});
});
test('failed, disconnected, stale and self-generated observations cannot stop local playback', () => {
  const observer = new SpotifyRemoteObserver();
  observer.observe(state(10000),10000);
  assert.equal(observer.observe(state(10200,{error:'Seek failed',playing:false}),10200),null);
  assert.equal(observer.observe(state(10400,{local:false,playing:false}),10400),null);
  assert.equal(observer.observe(state(10600,{playing:false}),13000),null);
  observer.commanded(14000);
  assert.equal(observer.observe(state(14200,{playing:false,position:0}),14200),null);
  assert.equal(observer.observe(state(18000,{syncing:true,playing:false}),18000),null);
  assert.equal(observer.observe(state(18200,{playing:false}),18200),null);
  assert.deepEqual(observer.observe(state(18400,{playing:true}),18400),{playing:true});
});
test('best-effort survives protocol validation and unavailable bridge never throws', () => {
  bestEffortSpotify(command => assert.deepEqual(parseTransportCommand(command),{
    action:'seek',trackId:'abc',position:12,bestEffort:true,
  }),{action:'seek',trackId:'abc',position:12});
  assert.doesNotThrow(() => bestEffortSpotify(() => {throw new Error('Disconnected');},{action:'play'}));
  assert.deepEqual(parseTransportCommand({action:'play',bestEffort:'true'}),{action:'play'});
});

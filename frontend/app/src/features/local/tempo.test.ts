import test from 'node:test';
import assert from 'node:assert/strict';
import { SongClock, validPitch, validTempo } from '../stems/player/tempo';
import { parseRecording, type PerformanceRecording } from './recording';
import { parseTransportCommand, parseListeningState } from './listeningProtocol';
test('song time integrates tempo changes, scheduled starts, seeks and pauses without changing elapsed performance time',()=>{
 let now=0;const clock=new SongClock(()=>now);
 clock.start(10,1,.02);assert.equal(clock.position,10);
 now=2.02;assert.equal(clock.position,12);clock.changeRate(1.5);
 now=4.02;assert.equal(clock.position,15);clock.pause();now=10;assert.equal(clock.position,15);
 clock.start(3,.5);now=12;assert.equal(clock.position,4);
});
test('v3 records independent tempo and pitch; v2 retains neutral defaults',()=>{
 const id='1111111111111111111111';
 const snapshot={tempo:1.5,pitch:-7,visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]};
 const value:PerformanceRecording={version:3,name:'mix',createdAt:'2026-10-14',spotifyPath:`album/${id}`,tracks:[{id,title:'Song',duration:10}],events:[{at:0,type:'track',trackId:id,position:0,snapshot},{at:2,type:'mix',trackId:id,position:3,snapshot:{...snapshot,tempo:.5,pitch:12}},{at:4,type:'stop',trackId:id,position:4}]};
 assert.equal(parseRecording(value).events[1].snapshot?.pitch,12);
 assert.throws(()=>parseRecording({...value,version:2}),/version 3/);
 for (const invalid of [NaN,Infinity,0,1.51]) assert.equal(validTempo(invalid),false);
 for (const invalid of [NaN,Infinity,-13,12.1]) assert.equal(validPitch(invalid),false);
 snapshot.tempo=2;assert.throws(()=>parseRecording(value));snapshot.tempo=1;
 snapshot.pitch=0;value.events.splice(1,1);value.version=2;assert.equal(parseRecording(value).version,2);
 delete (snapshot as {tempo?:number}).tempo;delete (snapshot as {pitch?:number}).pitch;
 assert.equal(parseRecording(value).version,2);
 value.version=3;assert.throws(()=>parseRecording(value),/missing tempo/);
});
test('rate transport validates bounds and ownership identity; legacy capabilities default safely',()=>{
 assert.deepEqual(parseTransportCommand({action:'rate',rate:1.25,trackId:'abc'}),{action:'rate',rate:1.25,trackId:'abc'});
 assert.equal(parseTransportCommand({action:'rate',rate:2,trackId:'abc'}),null);
 assert.equal(parseTransportCommand({action:'rate',rate:1}),null);
 const state={capability:1,trackId:'abc',generation:1,position:2,duration:10,playing:true,local:true,output:'stems',volume:.7,observedAt:1,error:''};
 assert.equal(parseListeningState(state)?.playbackRate,1);assert.equal(parseListeningState(state)?.tempoSupported,false);
 assert.equal(parseListeningState({...state,playbackRate:1.25,tempoSupported:true})?.playbackRate,1.25);
});

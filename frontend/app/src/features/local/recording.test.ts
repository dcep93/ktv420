import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecording, parseRecordingText, PerformanceClock, dueEvents, MAX_RECORDING_BYTES, type PerformanceRecording, type MixerSnapshot } from './recording';
const id='1111111111111111111111';
const snapshot: MixerSnapshot={visualizer:'time-ribbon',stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}],spotlight:null};
function recording(): PerformanceRecording {return {version:2,name:'test mix',createdAt:'2026-10-14',spotifyPath:`playlist/${id}`,tracks:[{id,title:'Song',duration:120}],events:[
 {at:0,type:'track',trackId:id,position:40,snapshot},
 {at:0,type:'play',trackId:id,position:40},
 {at:1,type:'mix',trackId:id,position:41,snapshot:{...snapshot,stems:[{...snapshot.stems[0],volume:.8}]}},
 {at:1.02,type:'mix',trackId:id,position:41.02,snapshot:{...snapshot,stems:[{...snapshot.stems[0],volume:.4}]}},
 {at:2,type:'seek',trackId:id,position:10},
 {at:3,type:'pause',trackId:id,position:11},
 {at:6,type:'play',trackId:id,position:11},
 {at:7,type:'stop',trackId:id,position:12},
]};}
test('portable performances retain fade samples and separate performance time from backwards song seeks',()=>{
 const mix=parseRecordingText(JSON.stringify(recording()));assert.equal(mix.events.length,8);
 assert.deepEqual(dueEvents(mix.events,2,1.03).events.map(e=>e.snapshot?.stems[0].volume),[.8,.4]);
 assert.equal(dueEvents(mix.events,4,2).events[0].position,10);
 assert.equal(dueEvents(mix.events,6,5.99).events.length,0);
});
test('performance clock freezes during user pause/loading and resumes without jumping automation',()=>{
 let now=100;const clock=new PerformanceClock(()=>now);clock.start();now=2100;assert.equal(clock.seconds,2);
 clock.pause();now=15100;assert.equal(clock.seconds,2);clock.start();now=16100;assert.equal(clock.seconds,3);
 clock.reset();assert.equal(clock.seconds,0);
});
test('invalid, unfinished, oversized and legacy performances fail before navigation or storage',()=>{
 assert.throws(()=>parseRecording({version:1}),/older recording/);
 assert.throws(()=>parseRecordingText('{'),/JSON recording/);
 assert.throws(()=>parseRecordingText(' '.repeat(MAX_RECORDING_BYTES+1)),/too large/);
 for(const mutate of [
  (r:PerformanceRecording)=>{r.spotifyPath='https://evil.example/playlist/foo'},
  (r:PerformanceRecording)=>{r.events[3].at=.5},
  (r:PerformanceRecording)=>{r.events[3].position=NaN},
  (r:PerformanceRecording)=>{r.events.pop()},
  (r:PerformanceRecording)=>{r.events[1].trackId='2222222222222222222222'},
  (r:PerformanceRecording)=>{r.events[0].snapshot!.stems[0].volume=30},
 ]) {const r=structuredClone(recording());mutate(r);assert.throws(()=>parseRecording(r));}
});
test('track changes must precede their automation and carry a starting snapshot',()=>{
 const r=recording(),other='2222222222222222222222';r.tracks.push({id:other,title:'Second',duration:30});
 r.events.splice(7,0,{at:6.5,type:'track',trackId:other,position:0,snapshot});r.events[8].trackId=other;
 assert.equal(parseRecording(r).tracks.length,2);
 delete r.events[7].snapshot;assert.throws(()=>parseRecording(r));
});

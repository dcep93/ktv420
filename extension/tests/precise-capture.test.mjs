import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreciseCapture, captureTiming } from '../src/content/preciseCapture.js';
function setup(overrides={}) {
 const calls=[];let position=12,paused=false,seeking=false,readyState=4,id='song';
 const media=()=>({source:'audio',currentTime:position,paused,seeking,readyState,playbackRate:1,duration:10});
 const options={trackId:'song',readTransport:()=>({trackId:id}),wait:async()=>{},
  transport:async command=>{calls.push(command.action);if(command.action==='pause')paused=true;if(command.action==='seek')position=0;if(command.action==='play')paused=false;},
  bridge:{command:async(command,payload)=>{calls.push(command);if(command==='capture-prepare')return{target:media()};if(command==='listening-state')return{media:media()};if(command==='capture-begin'){assert.ok(paused&&position===0&&!seeking);assert.equal(payload.requireStart,true);return{startVerified:true,target:media()};}return{};}},...overrides};
 return {calls,options,setMedia:values=>{position=values.position??position;paused=values.paused??paused;seeking=values.seeking??seeking;readyState=values.readyState??readyState;id=values.id??id;}};
}
test('capture warms, seeks and verifies paused zero twice before arming then playing',async()=>{
 const h=setup();const result=await startPreciseCapture(h.options);
 assert.equal(result.target.currentTime,0);assert.equal(result.startVerified,true);
 assert.deepEqual(h.calls,['capture-abort','pause','capture-prepare','seek','listening-state','listening-state','capture-begin','play']);
});
test('a rounded zero on Spotify UI cannot authorize a late or unresolved media start',async()=>{
 for(const condition of [{position:.25},{position:.001},{seeking:true},{readyState:1}]){
  const h=setup();const original=h.options.transport;
  h.options.transport=async command=>{await original(command);if(command.action==='seek')h.setMedia(condition);};
  await assert.rejects(startPreciseCapture(h.options),/did not settle/);
  assert.ok(!h.calls.includes('capture-begin'));assert.ok(!h.calls.includes('play'));
  assert.equal(h.calls.at(-1),'capture-abort');
 }
});
test('track changes and cancellation abort without resuming playback',async()=>{
 const h=setup();h.options.wait=async()=>h.setMedia({id:'different'});
 await assert.rejects(startPreciseCapture(h.options),/changed songs/);assert.ok(!h.calls.includes('play'));
 const cancelled=setup({checkCancelled:()=>{throw new Error('stopped');}});
 await assert.rejects(startPreciseCapture(cancelled.options),/stopped/);assert.deepEqual(cancelled.calls,['capture-abort']);
});
test('capture audit rejects legacy/unverified starts, missing heads, tails and malformed PCM',()=>{
 const capture={startVerified:true,startMediaTime:0,invalid:false,sampleRate:48000,channelCount:2,byteLength:48000*10*8};
 assert.equal(captureTiming(capture,10).captureDurationErrorSeconds,0);
 for(const change of [{startVerified:false},{startMediaTime:.1},{startMediaTime:NaN},{invalid:true},{byteLength:capture.byteLength-48000*8*.1},{byteLength:capture.byteLength+48000*8*.1},{byteLength:17}])assert.throws(()=>captureTiming({...capture,...change},10),/timing could not/);
});

test('capture errors distinguish unverified starts, interrupted audio and incorrect duration',()=>{
 const capture={startVerified:true,startMediaTime:0,sampleRate:48000,channelCount:2,byteLength:48000*10*8};
 assert.throws(()=>captureTiming({...capture,startVerified:false},10),/start of the song/);
 assert.throws(()=>captureTiming({...capture,invalid:true,invalidReason:'Spotify changed position during recording.'},10),/changed position/);
 assert.throws(()=>captureTiming({...capture,byteLength:48000*9*8},10),/1.000 seconds short/);
 assert.throws(()=>captureTiming({...capture,byteLength:48000*11*8},10),/1.000 seconds long/);
});

test('natural-end duration mismatch retains real frame count and requires collector proof', () => {
 const frames=48000*3-1200;
 const capture={startVerified:true,startMediaTime:0,invalid:false,sampleRate:48000,channelCount:2,
  byteLength:frames*8,rawCapturedFrames:frames,endVerified:true};
 const timing=captureTiming(capture,3);
 assert.equal(timing.capturedFrames,frames);
 assert.equal(timing.captureEndVerified,true);
 assert.ok(Math.abs(timing.captureDurationErrorSeconds+.025)<1e-10);
 for(const change of [{endVerified:false},{endVerified:undefined},{rawCapturedFrames:frames-128},{invalid:true},
  {byteLength:48000*2.9*8,rawCapturedFrames:48000*2.9}])assert.throws(()=>captureTiming({...capture,...change},3),/timing could not/);
});

test('storage audit uses the verified final duration rather than a provisional estimate', () => {
 const frames=48000*3;
 const capture={startVerified:true,startMediaTime:0,invalid:false,sampleRate:48000,channelCount:2,
  byteLength:frames*8,rawCapturedFrames:frames,endVerified:true,mediaDuration:3.025};
 assert.equal(captureTiming(capture,2.95).expectedDurationSeconds,3.025);
 assert.throws(()=>captureTiming({...capture,endVerified:false},2.95),/timing could not/);
});

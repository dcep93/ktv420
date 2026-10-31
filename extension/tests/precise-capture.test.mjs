import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreciseCapture, captureTiming } from '../src/content/preciseCapture.js';
function setup(overrides={}) {
 const calls=[];let position=12,paused=false,seeking=false,readyState=4,id='song';
 const media=()=>({source:'audio',currentTime:position,paused,seeking,readyState,playbackRate:1,duration:10});
 const options={trackId:'song',readTransport:()=>({trackId:id}),wait:async()=>{},
  transport:async command=>{calls.push(command.action);if(command.action==='pause')paused=true;if(command.action==='seek')position=0;if(command.action==='play')paused=false;},
  bridge:{command:async(command,payload)=>{calls.push(command);if(command==='capture-prepare')return{target:media()};if(command==='listening-state')return{media:media()};if(command==='capture-state'){if(!paused)position+=.05;return{...media(),invalid:false};}if(command==='capture-begin'){assert.ok(paused&&position===0&&!seeking);assert.equal(payload.requireStart,true);return{startVerified:true,target:media()};}return{};}},...overrides};
 return {calls,options,setMedia:values=>{position=values.position??position;paused=values.paused??paused;seeking=values.seeking??seeking;readyState=values.readyState??readyState;id=values.id??id;}};
}
test('capture warms, seeks and verifies paused zero twice before arming then playing',async()=>{
 const h=setup();const result=await startPreciseCapture(h.options);
 assert.equal(result.target.currentTime,0);assert.equal(result.startVerified,true);
 assert.deepEqual(h.calls,['capture-abort','pause','capture-prepare','seek','listening-state','listening-state','capture-begin','play',...Array(21).fill('capture-state')]);
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

test('storage audit retains verified resampler tail samples after zero-padding removal', () => {
 const frames=48000*3+1008;
 const capture={startVerified:true,startMediaTime:0,invalid:false,sampleRate:48000,channelCount:2,
  byteLength:frames*8,rawCapturedFrames:frames+24000,endVerified:true,mediaDuration:3};
 const timing=captureTiming(capture,3);
 assert.equal(timing.capturedFrames,frames);
 assert.ok(Math.abs(timing.captureDurationErrorSeconds-.021)<1e-10);
 for(const change of [{endVerified:false},{rawCapturedFrames:frames-1},{rawCapturedFrames:NaN},{invalid:true},
  {byteLength:(48000*3+2401)*8}])assert.throws(()=>captureTiming({...capture,...change},3),/timing could not/);
});

test('a UI seek that leaves actual audio at 2.824 seconds is corrected before capture', async () => {
 const h=setup(); const transport=h.options.transport, command=h.options.bridge.command;
 h.options.transport=async request=>{await transport(request);if(request.action==='seek')h.setMedia({position:2.824});};
 h.options.bridge.command=async (name,payload)=>{
  if(name==='capture-rewind'){
   h.calls.push(name);assert.equal(payload.expectedSource,'audio');h.setMedia({position:0,seeking:true});return{};
  }
  return command(name,payload);
 };
 h.options.wait=async()=>{if(h.calls.includes('capture-rewind'))h.setMedia({seeking:false});};
 const result=await startPreciseCapture(h.options);
 assert.equal(result.target.currentTime,0);
 assert.equal(h.calls.filter(name=>name==='capture-rewind').length,1);
 assert.ok(h.calls.indexOf('capture-rewind')<h.calls.indexOf('capture-begin'));
 assert.equal(h.calls.at(-1),'capture-state');
});

test('failed UI acknowledgment can recover only through actual verified media zero', async () => {
 const h=setup();const transport=h.options.transport;
 h.options.transport=async request=>{await transport(request);if(request.action==='seek')throw new Error('UI did not acknowledge');};
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
});

test('buffering can take longer than three seconds without allowing a late start', async () => {
 const h=setup();h.setMedia({readyState:2});let waits=0;
 h.options.wait=async()=>{if(++waits===80)h.setMedia({readyState:4});};
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
 assert.ok(waits>=80);assert.ok(!h.calls.includes('capture-rewind'));
});

test('a failed exact rewind stays bounded and reports actual blocking state', async () => {
 const h=setup();const transport=h.options.transport;
 h.options.transport=async request=>{await transport(request);if(request.action==='seek')h.setMedia({position:2.824});};
 await assert.rejects(startPreciseCapture(h.options),/audio position 2\.824s/);
 assert.equal(h.calls.filter(name=>name==='capture-rewind').length,1);
 assert.ok(!h.calls.includes('capture-begin'));assert.ok(!h.calls.includes('play'));
 const buffering=setup();buffering.setMedia({readyState:2});
 await assert.rejects(startPreciseCapture(buffering.options),/audio still buffering/);
});

test('a delayed startup reset discards the attempt and re-arms without another redundant UI seek', async () => {
 const h=setup();const command=h.options.bridge.command;
 let begins=0,polls=0;
 h.options.bridge.command=async(name,payload)=>{
  if(name==='capture-begin')begins++;
  if(name==='capture-state'&&begins===1&&++polls===5){
   h.setMedia({position:0});
   return{source:'audio',invalid:true,invalidCode:'startup-zero-seek',invalidReason:'reset at 0.240s'};
  }
  return command(name,payload);
 };
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
 assert.equal(begins,2);
 assert.equal(h.calls.filter(name=>name==='capture-abort').length,2);
 assert.equal(h.calls.filter(name=>name==='pause').length,2);
 assert.equal(h.calls.filter(name=>name==='seek').length,1);
 assert.equal(h.calls.filter(name=>name==='play').length,2);
});

test('repeated startup resets are bounded; unrelated failures never restart', async () => {
 for(const failure of [
  {source:'audio',invalidCode:'startup-zero-seek',expectedBegins:3},
  {source:'different',invalidCode:'startup-zero-seek',expectedBegins:1},
  {source:'audio',invalidCode:'startup-audio-gap',expectedBegins:3},
  {source:'different',invalidCode:'startup-audio-gap',expectedBegins:1},
  {source:'audio',invalidCode:'audio-gap',expectedBegins:1},
  {source:'audio',invalidCode:'seek',expectedBegins:1},
  {source:'audio',invalidCode:'',expectedBegins:1},
 ]){
  const h=setup();const command=h.options.bridge.command;
  h.options.bridge.command=async(name,payload)=>name==='capture-state'?{...failure,invalid:true,invalidReason:'test interruption'}:command(name,payload);
  await assert.rejects(startPreciseCapture(h.options),/test interruption/);
  assert.equal(h.calls.filter(name=>name==='capture-begin').length,failure.expectedBegins);
  assert.equal(h.calls.at(-1),'capture-abort');
 }
});

test('startup observation honors stop, track changes and very short natural completion', async () => {
 for(const change of ['stop','track']){
  const h=setup();let stopped=false;
  h.options.checkCancelled=()=>{if(stopped)throw Error('stopped');};
  h.options.wait=async()=>{if(h.calls.includes('play')){if(change==='stop')stopped=true;else h.setMedia({id:'different'});}};
  await assert.rejects(startPreciseCapture(h.options),change==='stop'?/stopped/:/changed songs/);
  assert.equal(h.calls.filter(name=>name==='play').length,1);
  assert.equal(h.calls.at(-1),'capture-abort');
 }
 const h=setup();const command=h.options.bridge.command;
 h.options.bridge.command=async(name,payload)=>name==='capture-state'?{ended:true,invalid:false}:command(name,payload);
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
});


test('a missing Spotify pause-button acknowledgment still reaches the actual-media pause and zero verification', async () => {
 for(const uiAppliedPause of [true,false]){
  const h=setup();const transport=h.options.transport,command=h.options.bridge.command;
  h.options.transport=async request=>{
   if(request.action==='pause'){
    if(uiAppliedPause)await transport(request);
    throw Error('Spotify did not change playback state.');
   }
   return transport(request);
  };
  h.options.bridge.command=async(name,payload)=>{
   // capture-prepare explicitly pauses the selected media in the page hook.
   if(name==='capture-prepare')h.setMedia({paused:true});
   return command(name,payload);
  };
  assert.equal((await startPreciseCapture(h.options)).startVerified,true);
  assert.ok(h.calls.indexOf('capture-prepare')<h.calls.indexOf('capture-begin'));
  assert.equal(h.calls.filter(name=>name==='capture-begin').length,1);
 }
});

test('a failed pause is never ignored if actual audio keeps playing or preparation fails', async () => {
 for(const prepareFails of [false,true]){
  const h=setup();const transport=h.options.transport,command=h.options.bridge.command;
  h.options.transport=async request=>{
   if(request.action==='pause')throw Error('Spotify did not change playback state.');
   return transport(request);
  };
  h.options.bridge.command=async(name,payload)=>{
   if(name==='capture-prepare'&&prepareFails)throw Error('Current audio unavailable');
   return command(name,payload);
  };
  await assert.rejects(startPreciseCapture(h.options),prepareFails?/Current audio unavailable/:/audio still playing/);
  assert.ok(!h.calls.includes('capture-begin'));assert.ok(!h.calls.includes('play'));
  assert.equal(h.calls.at(-1),'capture-abort');
 }
});

test('stop during a failed pause acknowledgment prevents media preparation and playback', async () => {
 let cancelled=false;
 const h=setup({checkCancelled:()=>{if(cancelled)throw Error('stopped');}});
 h.options.transport=async()=>{cancelled=true;throw Error('Spotify did not change playback state.');};
 await assert.rejects(startPreciseCapture(h.options),/stopped/);
 assert.ok(!h.calls.includes('capture-prepare'));assert.ok(!h.calls.includes('capture-begin'));
 assert.equal(h.calls.at(-1),'capture-abort');
});

test('Play is verified against moving local audio even when its button acknowledgment fails', async () => {
 const h=setup();const transport=h.options.transport;
 h.options.transport=async request=>{await transport(request);if(request.action==='play')throw Error('Spotify did not change playback state.');};
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
 assert.ok(!h.calls.includes('capture-play'),'already-playing audio must not be played twice');
});

test('stale Play acknowledgment uses the armed-media fallback and rejects a frozen clock', async () => {
 for(const frozen of [false,true]){
  const h=setup();const transport=h.options.transport,command=h.options.bridge.command;
  h.options.transport=async request=>{if(request.action!=='play')return transport(request);};
  h.options.bridge.command=async(name,payload)=>{
   if(name==='capture-play'){
    h.calls.push(name);h.setMedia({paused:false});return{paused:false,currentTime:0};
   }
   if(name==='capture-state'&&frozen)return{source:'audio',paused:h.calls.includes('capture-play')?false:true,currentTime:0,invalid:false};
   return command(name,payload);
  };
  if(frozen)await assert.rejects(startPreciseCapture(h.options),/local audio did not start playing/);
  else assert.equal((await startPreciseCapture(h.options)).startVerified,true);
  assert.equal(h.calls.filter(name=>name==='capture-play').length,1);
 }
});


test('a media replacement during rewind is re-prepared and verified from zero', async () => {
 const h=setup();const command=h.options.bridge.command;let source='audio',prepares=0;
 h.options.bridge.command=async(name,payload)=>{
  if(name==='capture-prepare')prepares++;
  const result=await command(name,payload);
  if(name==='listening-state'&&prepares===1){source='replacement';h.setMedia({position:.151});}
  if(result.target)result.target={...result.target,source};
  if(result.media)result.media={...result.media,source};
  if(name==='capture-begin')assert.equal(payload.expectedSource,'replacement');
  if(name==='capture-state')return {...result,source};
  return result;
 };
 const result=await startPreciseCapture(h.options);
 assert.equal(prepares,2);assert.equal(result.startVerified,true);
 assert.equal(result.target.currentTime,0);
 assert.equal(h.calls.filter(name=>name==='capture-begin').length,1);
});

test('repeated media replacements exhaust a bounded retry without recording', async () => {
 const h=setup();const command=h.options.bridge.command;let prepares=0;
 h.options.bridge.command=async(name,payload)=>{
  const result=await command(name,payload);
  if(name==='capture-prepare'){prepares++;result.target.source=`prepared-${prepares}`;}
  if(result.media)result.media.source='another-source';
  return result;
 };
 await assert.rejects(startPreciseCapture(h.options),/audio source changed/);
 assert.equal(prepares,3);assert.ok(!h.calls.includes('capture-begin'));
});


test('an empty startup audio gap is discarded and recaptured from verified zero', async () => {
 const h=setup(), command=h.options.bridge.command;let begins=0;
 h.options.bridge.command=async(name,payload)=>{
  if(name==='capture-begin')begins++;
  if(name==='capture-state'&&begins===1){
   h.setMedia({position:.01});
   return {source:'audio',invalid:true,invalidCode:'startup-audio-gap',invalidReason:'first quantum missing'};
  }
  return command(name,payload);
 };
 assert.equal((await startPreciseCapture(h.options)).startVerified,true);
 assert.equal(begins,2);
 assert.equal(h.calls.filter(name=>name==='capture-abort').length,2);
 assert.equal(h.calls.filter(name=>name==='seek').length,2);
 assert.equal(h.calls.filter(name=>name==='play').length,2);
});

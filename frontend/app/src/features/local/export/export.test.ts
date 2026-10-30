import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileExport, eventQuanta, EXPORT_RATE, exportGain, checkExportMemory } from './timeline';
import { encodePerformance } from './encode';
import { validateMp3 } from '../audio/mp3Validation';
import { getLogarithmicVolumeGain } from '../../stems/player/mixerGain';
import type { PerformanceRecording, MixerSnapshot } from '../recording';
const id='1111111111111111111111',id2='2222222222222222222222';
const snapshot:MixerSnapshot={tempo:1,pitch:0,visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]};
const recording:PerformanceRecording={version:3,name:'mix',createdAt:'2026-10-14',spotifyPath:`playlist/${id}`,tracks:[{id,title:'One',duration:10},{id:id2,title:'Two',duration:10}],events:[
  {at:0,type:'track',trackId:id,position:0,snapshot},{at:0,type:'play',trackId:id,position:0},
  {at:1,type:'pause',trackId:id,position:1},{at:2,type:'seek',trackId:id,position:5},
  {at:3,type:'play',trackId:id,position:5},{at:4.0001,type:'track',trackId:id2,position:0,snapshot},
  {at:4.0001,type:'play',trackId:id2,position:0},{at:4.0002,type:'mix',trackId:id2,position:0,snapshot},
  {at:6,type:'stop',trackId:id2,position:2}]};
test('export retains pauses/seeks and rounds section boundaries without cumulative drift',()=>{
  const plan=compileExport(recording);assert.equal(plan.frames,6*EXPORT_RATE);assert.equal(plan.sections.length,2);
  assert.equal(plan.sections.reduce((sum,section)=>sum+section.frames,0),plan.frames);
  assert.deepEqual(plan.sections[0].events.map(event=>event.type),['track','play','pause','seek','play']);
  const groups=eventQuanta(plan.sections[1]);assert.deepEqual(groups[0][1].map(event=>event.type),['track','play','mix']);
  assert.equal(new Set(groups.map(([frame])=>frame)).size,groups.length);
});
test('invalid effects, empty timelines and unsafe memory allocations fail before rendering',()=>{
  const bad=structuredClone(recording);bad.events[0].snapshot!.stems[0].effect='unknown';assert.throws(()=>compileExport(bad),/unsupported/);
  const empty=structuredClone(recording);empty.events=empty.events.slice(0,1).concat({at:0,type:'stop',trackId:id,position:0});assert.throws(()=>compileExport(empty),/no audio/);
  assert.doesNotThrow(()=>checkExportMemory(300,5,300*EXPORT_RATE));
  assert.throws(()=>checkExportMemory(3600,5,3600*EXPORT_RATE),/too large/);
});
test('export uses the live logarithmic gain curve and only attenuates a clipping mix',()=>{
  assert.equal(getLogarithmicVolumeGain(0),0);assert.equal(getLogarithmicVolumeGain(1),1);
  assert.ok(Math.abs(getLogarithmicVolumeGain(.5)-10**(-32/20))<1e-12);
  assert.equal(exportGain(.5),1);assert.equal(exportGain(2),.475);assert.throws(()=>exportGain(NaN));
});
test('streaming stereo encoding across chunks produces one aligned 320 kbps gapless MP3',async()=>{
  const frames=EXPORT_RATE*2+17,pcm=new Float32Array(frames*2),progress:number[]=[];
  for(let i=0;i<frames;i++){pcm[i*2]=.3*Math.sin(i*.04);pcm[i*2+1]=.2*Math.sin(i*.07);}
  const blob=await encodePerformance(new Blob([pcm]),frames,1,value=>progress.push(value));
  await validateMp3(blob,EXPORT_RATE,frames);assert.equal(progress.at(-1),1);assert.ok(progress.length>1);
  await assert.rejects(encodePerformance(new Blob([pcm]),frames-1,1,()=>{}),/Incomplete/);
  pcm[100]=Infinity;await assert.rejects(encodePerformance(new Blob([pcm]),frames,1,()=>{}),/invalid audio/);
});

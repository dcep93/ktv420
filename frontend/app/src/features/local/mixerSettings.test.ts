import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsForTracks } from '../stems/player/mixerSettings';
import type { MixerSnapshot } from './recording';

const saved: MixerSnapshot = {
  tempo:1.24,pitch:-3,visualizer:'stem-garden',
  spotlight:{intent:{kind:'output',name:'vocals.mp3'},level:'track-with-selectors'},
  stems:[
    {name:'vocals.mp3',input:false,volume:.42,mute:false,deafen:true,effect:'reverb',value:.81},
    {name:'drums.mp3',input:false,volume:.7,mute:true,deafen:false,effect:'chorus',value:.2},
    {name:'original.mp3',input:true,volume:.1,mute:true,deafen:false,effect:'wah',value:.5},
  ],
};
test('new songs inherit every mixer choice by stem identity, independent of order',()=>{
  const next=settingsForTracks(saved,[
    {name:'drums.mp3',isInput:false},{name:'vocals.mp3',isInput:false},{name:'original.mp3',isInput:true},
  ]);
  assert.deepEqual(next,{...saved,stems:[saved.stems[1],saved.stems[0],saved.stems[2]]});
  next.stems[1].volume=1;
  next.spotlight!.level='track';
  assert.equal(saved.stems[0].volume,.42);
  assert.equal(saved.spotlight!.level,'track-with-selectors');
});
test('missing or different stem identities use defaults and unavailable spotlight clears',()=>{
  const next=settingsForTracks(saved,[{name:'bass.mp3',isInput:false},{name:'vocals.mp3',isInput:true}]);
  assert.equal(next.spotlight,null);
  assert.equal(next.tempo,1.24);
  assert.equal(next.visualizer,'stem-garden');
  assert.deepEqual(next.stems.map(s=>[s.volume,s.mute,s.deafen,s.effect]),[[1,false,false,'wah'],[1,true,false,'wah']]);
});
test('first song uses normal defaults and input spotlight survives new input filenames',()=>{
  const tracks=[{name:'vocals.mp3',isInput:false},{name:'new-original.mp3',isInput:true}];
  const first=settingsForTracks(null,tracks);
  assert.equal(first.tempo,1);assert.equal(first.pitch,0);assert.equal(first.spotlight,null);
  const next=settingsForTracks({...saved,spotlight:{intent:{kind:'input'},level:'track'}},tracks);
  assert.deepEqual(next.spotlight,{intent:{kind:'input'},level:'track'});
});

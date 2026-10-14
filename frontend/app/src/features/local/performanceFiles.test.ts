import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savePerformance,loadPerformance} from './performanceFiles';
import type {PerformanceRecording} from './recording';
test('import survives closing the database and remains separate from recorded drafts and completed mixes',async()=>{
 const id='1111111111111111111111';const value:PerformanceRecording={version:2,name:'test',createdAt:'2026-10-14',spotifyPath:`album/${id}`,tracks:[{id,title:'Song',duration:20}],events:[{at:0,type:'track',trackId:id,position:0,snapshot:{visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]}},{at:1,type:'stop',trackId:id,position:1}]};
 await savePerformance('import',value);await savePerformance('draft',{...value,name:'draft'});
 assert.deepEqual(await loadPerformance('import'),value);await savePerformance('draft',null);
 assert.equal(await loadPerformance('draft'),null);assert.deepEqual(await loadPerformance('import'),value);
});

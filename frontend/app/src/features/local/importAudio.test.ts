import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importAudio} from './importAudio.ts';
import {getInput,deleteTrack} from './library.ts';
test('mono PCM32 WAV input is stored byte-for-byte, without Float32 quantization or stereo duplication',async()=>{
 const buffer=new ArrayBuffer(48); const view=new DataView(buffer);
 for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const) for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));
 view.setUint32(4,40,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,32,true);
 view.setUint32(40,4,true);view.setInt32(44,2147483647,true);
 const id=await importAudio(new File([buffer],'mono.wav',{type:'audio/wav'}));
 assert.deepEqual(new Uint8Array(await(await getInput(id)).arrayBuffer()),new Uint8Array(buffer));
 await deleteTrack(id);
});

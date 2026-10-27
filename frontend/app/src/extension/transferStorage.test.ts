import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeMp3Set} from '../features/local/audio/mp3';
import {MP3_NAMES} from '../features/local/audio/mp3Types';
import {digest,type Bundle,type BundleTrack} from '../features/local/transfer/manifest';
import {beginImport,exportCollection,importTrack} from './transferStorage';
import {getPlaybackRecord,getTrack,deleteTrack,saveInput,transaction} from '../features/local/library';
import {savedCollection} from './collectionRegistry';
import {updateState} from './state';
import {createTransferBridge} from './transferBridge';
import type {BrokerLocks} from './libraryBroker';
const locks={request:async(_name:string,_options:LockOptions,cb:LockGrantedCallback<unknown>)=>cb({name:'ktv420-separation',mode:'exclusive'})} as BrokerLocks;
async function fixture() {
 const id=crypto.randomUUID().replaceAll('-','');
 const audio={left:new Float32Array(2401),right:new Float32Array(2401),sampleRate:44100};
 const encoded=await encodeMp3Set(audio,{drums:audio,bass:audio,other:audio,vocals:audio});
 const files=Object.fromEntries(await Promise.all(MP3_NAMES.map(async name=>[name,{path:`tracks/${id}/${name}.mp3`,bytes:encoded.files[name].size,sha256:await digest(encoded.files[name])}])));
 const track:BundleTrack={id,title:'Shared song',artist:'Artist',sampleRate:44100,frames:2401,encoding:encoded.encoding,crop:'0.01-0',artworkUrl:'',files:files as BundleTrack['files']};
 const collection={path:'playlist/2222222222222222222222',title:'Shared playlist',artwork:'',trackIds:[id]};
 const bundle:Bundle={format:'ktv420-playlist',version:1,collection,tracks:[track]};return {bundle,track,files:encoded.files};
}
test('fresh-profile import registers playlist, commits original and four stems, preserves gain and retries idempotently',async()=>{
 const {bundle,track,files}=await fixture();const value={track,collection:bundle.collection};
 assert.deepEqual(await beginImport(bundle),[]);
 assert.equal((await savedCollection(bundle.collection.path)).tracks[0].trackId,track.id);
 assert.equal(await importTrack(value,files,null,locks,async()=>({})),'saved');
 const saved=await getTrack(`spotify-${track.id}`);assert.equal(saved?.status,'ready');assert.equal(saved?.metadata?.crop,'0.01-0');
 const record=await getPlaybackRecord(`spotify-${track.id}`);assert.equal(record.files.length,5);assert.equal(record.playbackGain,track.encoding.gain);
 for(const name of MP3_NAMES)assert.deepEqual(await record.files.find(f=>f.name===`${name}.mp3`)!.blob.arrayBuffer(),await files[name].arrayBuffer());
 assert.equal(await importTrack({...value,track:{...track,title:'Do not replace'}},files,null,locks,async()=>({})),'skipped');
 assert.equal((await getTrack(saved!.id))?.title,'Shared song');assert.deepEqual(await beginImport(bundle),[track.id]);
 assert.equal((await exportCollection(bundle.collection.path)).collection.title,'Shared playlist');await deleteTrack(saved!.id);
});
test('damaged audio, low quota and active Spotify fail without replacing existing capture',async()=>{
 const {bundle,track,files}=await fixture();const id=`spotify-${track.id}`,value={track,collection:bundle.collection};
 await saveInput({id,title:'Capture',artist:'',sampleRate:44100,frames:2401,status:'captured',bytes:3,source:'spotify',createdAt:1},new Blob(['raw']));
 const damaged={...files,input:new Blob([new Uint8Array(files.input.size)])};
 await assert.rejects(importTrack(value,damaged,null,locks,async()=>({})),/Damaged/);
 await assert.rejects(importTrack(value,files,null,locks,async()=>({quota:100,usage:0})),/storage/);
 await updateState('listeningLease',()=>({tabId:3,expires:Date.now()+30000}));
 await assert.rejects(importTrack(value,files,null,locks,async()=>({})),/Close/);
 await updateState('listeningLease',()=>undefined);assert.equal((await getTrack(id))?.status,'captured');
 assert.equal(await importTrack(value,files,null,locks,async()=>({})),'saved');await deleteTrack(id);
});
test('incomplete ready records are repaired, not skipped',async()=>{
 const {bundle,track,files}=await fixture(),id=`spotify-${track.id}`;
 await importTrack({track,collection:bundle.collection},files,null,locks,async()=>({}));
 await transaction(['audio'],'readwrite',tx=>{tx.objectStore('audio').delete(`${id}/vocals.mp3`);});
 assert.deepEqual(await beginImport(bundle),[]);
 assert.equal(await importTrack({track,collection:bundle.collection},files,null,locks,async()=>({})),'saved');await deleteTrack(id);
});
test('transfer bridge rejects wrong origins, windows and capture operations',async()=>{
 const messages:unknown[]=[];const parent={postMessage:(data:unknown)=>{messages.push(data);}};
 const bridge=createTransferBridge(parent,'https://ktv420.web.app',locks,async()=>({}));
 const event={source:parent as unknown as Window,origin:'https://evil.test',data:{source:'ktv420-transfer',type:'hello'}};
 await bridge.receive(event);await bridge.receive({...event,origin:'https://ktv420.web.app',source:{} as Window});assert.equal(messages.length,0);
 await bridge.receive({...event,origin:'https://ktv420.web.app'});assert.equal(messages.length,1);
 await bridge.receive({...event,origin:'https://ktv420.web.app',data:{source:'ktv420-library',version:2,id:'test',method:'beginCapture',args:[]} as never});
 assert.match(JSON.stringify(messages[1]),/Unsupported/);bridge.dispose();
});
test('embedded raster artwork survives import without becoming an audio track; catalog order follows package',async()=>{
 const {bundle,track,files}=await fixture();
 const cover=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});
 track.artwork={path:`tracks/${track.id}/artwork`,bytes:cover.size,sha256:await digest(cover)};
 await beginImport(bundle);await importTrack({track,collection:bundle.collection},files,cover,locks,async()=>({}));
 const record=await getPlaybackRecord(`spotify-${track.id}`);assert.equal(record.files.length,5);assert.equal(record.artwork?.type,'image/png');assert.deepEqual(await record.artwork!.arrayBuffer(),await cover.arrayBuffer());
 await updateState('collections',previous=>previous?.map(c=>c.path===bundle.collection.path?{...c,trackIds:['old',...c.trackIds]}:c));
 await beginImport(bundle);assert.deepEqual((await savedCollection(bundle.collection.path)).trackIds,bundle.collection.trackIds);
 await deleteTrack(`spotify-${track.id}`);
});

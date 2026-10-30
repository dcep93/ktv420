import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BlobWriter,BlobReader,ZipWriter,ZipReader} from '@zip.js/zip.js';
import {parseBundle,digest,bundleAssets,MANIFEST,MAX_AUDIO,type Bundle} from './manifest';
import {openZip,openFolder} from './archive';
import {exportPlaylist,importPlaylist,type TransferClient} from './transfer';
import {MP3_NAMES} from '../audio/mp3Types';
const signal=()=>new AbortController().signal;
const collection={path:'album/1111111111111111111111',title:'Transfer album',artwork:'',trackIds:['songA','songB']};
async function fixture() {
 const blob=new Blob(['untouched mp3 bytes']),sha256=await digest(blob);
 const bundle:Bundle={format:'ktv420-playlist',version:2,collection,tracks:collection.trackIds.map(id=>({id,title:id,artist:'Artist',sampleRate:44100,frames:44100,encoding:{sampleRate:44100,frames:44100,gain:.5},crop:'0-0',artworkUrl:'',files:Object.fromEntries(MP3_NAMES.map(name=>[name,{path:`tracks/${id}/${name}.mp3`,bytes:blob.size,sha256}])) as Bundle['tracks'][number]['files']}))};
 return {blob,bundle};
}
async function zipFixture(bundle:Bundle,blob:Blob,change?:(path:string)=>Blob|undefined) {
 const output=new BlobWriter(),writer=new ZipWriter(output,{level:0,useWebWorkers:false});
 for(const asset of bundleAssets(bundle))await writer.add(asset.path,new BlobReader(change?.(asset.path)||blob));
 await writer.add(MANIFEST,new BlobReader(new Blob([JSON.stringify(bundle)])));return await writer.close();
}
test('format validates versions, membership, paths, hashes, size, timing and complete five files',async()=>{
 const {bundle}=await fixture(); assert.deepEqual(parseBundle(bundle),bundle);
 const reject=(change:(v:Bundle)=>void)=>{const copy=structuredClone(bundle);change(copy);assert.throws(()=>parseBundle(copy));};
 reject(v=>{v.version=1 as 2;});reject(v=>{v.tracks[0].id='wrong';});reject(v=>{v.tracks[0].files.input.path='../input.mp3';});reject(v=>{v.tracks[0].files.input.bytes=MAX_AUDIO+1;});reject(v=>{v.tracks[0].encoding.frames++;});reject(v=>{v.tracks[0].encoding.gain=0;});reject(v=>{v.tracks[0].files.input.sha256='bad';});reject(v=>{delete (v.tracks[0].files as Partial<Bundle['tracks'][number]['files']>).input;});
});
test('ZIP and extracted folder preserve exact bytes; folder roots and macOS metadata are accepted',async()=>{
 const {bundle,blob}=await fixture();const zip=await zipFixture(bundle,blob);const source=await openZip(zip,signal());
 assert.deepEqual(source.bundle,bundle);
 for(const asset of bundleAssets(bundle))assert.deepEqual(await (await source.read(asset,signal())).arrayBuffer(),await blob.arrayBuffer());
 await source.close();
 const files=[...bundleAssets(bundle).map(a=>[a.path,blob] as const),[MANIFEST,new Blob([JSON.stringify(bundle)])] as const,['.DS_Store',new Blob(['ignore'])] as const].map(([path,value])=>{const f=new File([value],path.split('/').pop()!);Object.defineProperty(f,'webkitRelativePath',{value:`Album/${path}`});return f;});
 const folder=await openFolder(files,signal());assert.deepEqual(folder.bundle,bundle);await folder.close();
 await assert.rejects(openFolder(files.filter(file=>!file.webkitRelativePath.endsWith('input.mp3')),signal()),/Missing/);
});
test('export is sequential, byte-identical and import skips ready songs; cancellation stops after a committed song',async()=>{
 const {bundle,blob}=await fixture();let inFlight=0,maximum=0;
 const client={async request(method:string,args:unknown[]=[]){inFlight++;maximum=Math.max(maximum,inFlight);try{
   if(method==='exportCollection')return {collection,bytes:blob.size*10};
   const id=args[0]; return {track:{title:id,artist:'Artist',sampleRate:44100,frames:44100,metadata:{}},record:{playbackGain:.5,files:MP3_NAMES.map(name=>({name:`${name}.mp3`,blob}))}};
 }finally{inFlight--;}}} as TransferClient;
 const chunks:Uint8Array<ArrayBuffer>[]=[];let closed=false;
 const result=await exportPlaylist(client,collection.path,new WritableStream({write(chunk){chunks.push(Uint8Array.from(chunk));},close(){closed=true;}}),signal(),()=>{});
 assert.ok(closed);assert.equal(maximum,1);assert.equal(result.bundle.tracks[0].encoding.gain,.5);
 const source=await openZip(new Blob(chunks),signal());let imported=0;
 const importer={async request(method:string){if(method==='beginImport')return ['songA'];imported++;return 'saved';}} as TransferClient;
 assert.deepEqual(await importPlaylist(importer,source,signal(),()=>{}),{saved:1,skipped:1,path:collection.path});assert.equal(imported,1);
 const abort=new AbortController();let commits=0;
 const cancel={async request(method:string){if(method==='beginImport')return [];commits++;abort.abort();return 'saved';}} as TransferClient;
 await assert.rejects(importPlaylist(cancel,source,abort.signal,()=>{}),/abort/i);assert.equal(commits,1);await source.close();
 assert.equal(bundle.tracks.length,result.bundle.tracks.length);
});
test('corrupt ZIP CRC, unexpected files and unsafe paths fail without import',async()=>{
 const {bundle,blob}=await fixture();
 const writer=new ZipWriter(new BlobWriter(),{level:0,useWebWorkers:false});
 await writer.add('../bad',new BlobReader(blob));await writer.add(MANIFEST,new BlobReader(new Blob([JSON.stringify(bundle)])));
 await assert.rejects(openZip(await writer.close(),signal()),/Unsafe/);
 const valid=await zipFixture(bundle,blob);const bytes=new Uint8Array(await valid.arrayBuffer());
 const marker=new TextEncoder().encode('untouched mp3 bytes');let offset=-1;
 for(let i=0;i<bytes.length-marker.length;i++)if(marker.every((v,j)=>bytes[i+j]===v)){offset=i;break;}
 assert.ok(offset>0);bytes[offset]^=1;
 const broken=await openZip(new Blob([bytes]),signal());await assert.rejects(broken.read(bundle.tracks[0].files.input,signal()));await broken.close();
 const reader=new ZipReader(new BlobReader(valid));assert.equal((await reader.getEntries()).length,11);await reader.close();
});
test('compressed ZIPs with a containing folder import correctly',async()=>{
 const {bundle,blob}=await fixture();const writer=new ZipWriter(new BlobWriter(),{level:6,useWebWorkers:false,useCompressionStream:true});
 for(const asset of bundleAssets(bundle))await writer.add(`Playlist/${asset.path}`,new BlobReader(blob));
 await writer.add(`Playlist/${MANIFEST}`,new BlobReader(new Blob([JSON.stringify(bundle)])));
 const source=await openZip(await writer.close(),signal());assert.deepEqual(await (await source.read(bundle.tracks[1].files.vocals,signal())).text(),await blob.text());await source.close();
});

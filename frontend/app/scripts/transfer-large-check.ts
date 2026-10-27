// Explicit integration check; intentionally excluded from the regular fast suite.
import {createWriteStream,openAsBlob} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Writable} from 'node:stream';
import {exportPlaylist,importPlaylist,type TransferClient} from '../src/features/local/transfer/transfer';
import {openZip} from '../src/features/local/transfer/archive';
import {verifyAsset,type BundleTrack} from '../src/features/local/transfer/manifest';
import {MP3_NAMES,type Mp3Files} from '../src/features/local/audio/mp3Types';
import {ZipWriter,Reader} from '@zip.js/zip.js';
import assert from 'node:assert/strict';
const target=process.argv[2];if(!target)throw new Error('Supply a temporary ZIP output path.');
const collection={path:'album/3333333333333333333333',title:'Large transfer test',artwork:'',trackIds:Array.from({length:30},(_,i)=>`song${i}`)};
const blob=new Blob([new Uint8Array(20*1024**2)]);
let peak=process.memoryUsage().rss;const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},100);
const client={async request(method:string,args:unknown[]=[]){if(method==='exportCollection')return {collection,bytes:blob.size*150};return {track:{title:String(args[0]),artist:'Synthetic',sampleRate:44100,frames:44100*524,metadata:{}},record:{playbackGain:1,files:MP3_NAMES.map(name=>({name:`${name}.mp3`,blob}))}};}} as TransferClient;
const started=Date.now();
try {
 await exportPlaylist(client,collection.path,Writable.toWeb(createWriteStream(target)) as WritableStream<Uint8Array>,new AbortController().signal,()=>{});
 const zip=await openAsBlob(target);assert.ok(zip.size>3_000_000_000);
 const source=await openZip(zip,new AbortController().signal);let commits=0;
 const sink={async request(method:string,args:unknown[]=[]){if(method==='beginImport')return [];const {track}=args[0] as {track:BundleTrack};const files=args[1] as Mp3Files;for(const name of MP3_NAMES)await verifyAsset(files[name],track.files[name]);commits++;return 'saved';}} as TransferClient;
 const result=await importPlaylist(sink,source,new AbortController().signal,()=>{});await source.close();assert.equal(commits,30);assert.equal(result.saved,30);
 console.log(JSON.stringify({test:'3 GB ZIP export/import with every hash checked',archiveBytes:zip.size,songs:commits,peakRssMiB:Math.round(peak/1024**2),seconds:Math.round((Date.now()-started)/1000)}));
}finally{await unlink(target).catch(()=>{});}
// Exercise an actual ZIP64 offset/entry across 4 GiB without retaining the payload.
class LargeReader extends Reader<Uint8Array> {constructor(){super(new Uint8Array());this.size=0x100000000+65536;} async readUint8Array(_offset:number,length:number){return new Uint8Array(length);}}
let count=0,tail=new Uint8Array(0);
const writer=new ZipWriter(new WritableStream<Uint8Array>({write(chunk){count+=chunk.length; if(chunk.length<4096){const combined=new Uint8Array(tail.length+chunk.length);combined.set(tail);combined.set(chunk,tail.length);tail=combined.slice(-4096);}}}),{level:0,useWebWorkers:false,bufferedWrite:false});
await writer.add('beyond-4GiB.bin',new LargeReader());await writer.close();
const view=new DataView(tail.buffer);let zip64=false;for(let i=0;i<=tail.length-4;i++)if(view.getUint32(i,true)===0x06064b50)zip64=true;
assert.ok(count>0x100000000);assert.ok(zip64);clearInterval(sampler);
console.log(JSON.stringify({test:'ZIP64 beyond 4 GiB',streamedBytes:count,zip64,peakRssMiB:Math.round(peak/1024**2)}));

import {encodeMp3Set} from './src/features/local/audio/mp3';
import {MP3_NAMES} from './src/features/local/audio/mp3Types';
import {connectTransfer} from './src/features/local/transfer/client';
import {digest,bundleAssets,MANIFEST,type Bundle} from './src/features/local/transfer/manifest';
import {openZip,openFolder} from './src/features/local/transfer/archive';
import {exportPlaylist,importPlaylist} from './src/features/local/transfer/transfer';
import {ZipWriter,BlobWriter,BlobReader} from '@zip.js/zip.js';
const report=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#run')!;
button.onclick=async()=>{
 button.disabled=true;try {
  const client=connectTransfer(),signal=new AbortController().signal;
  const rate=44100,frames=rate*8,left=Float32Array.from({length:frames},(_,i)=>.1*Math.sin(2*Math.PI*220*i/rate)*Math.sin(Math.PI*i/frames)**2),audio={left,right:left,sampleRate:rate};
  report.textContent='Encoding synthetic audio…';
  const encoded=await encodeMp3Set(audio,{drums:audio,bass:audio,other:audio,vocals:audio});
  const ids=['standaloneA','standaloneB'];const bundle:Bundle={format:'ktv420-playlist',version:2,collection:{path:'album/0000000000000000000007',title:'Standalone verification',artwork:'',trackIds:ids,complete:true},tracks:[]};
  for(const id of ids){const files={} as Bundle['tracks'][number]['files'];for(const name of MP3_NAMES)files[name]={path:`tracks/${id}/${name}.mp3`,bytes:encoded.files[name].size,sha256:await digest(encoded.files[name])};bundle.tracks.push({id,title:id==='standaloneA'?'Synthetic One':'Synthetic Two',artist:'Local test fixture',sampleRate:rate,frames,encoding:encoded.encoding,crop:'0-0',artworkUrl:'',files});}
  const out=new BlobWriter(),writer=new ZipWriter(out,{level:0});
  for(const track of bundle.tracks)for(const name of MP3_NAMES)await writer.add(track.files[name].path,new BlobReader(encoded.files[name]));
  await writer.add(MANIFEST,new BlobReader(new Blob([JSON.stringify(bundle)])));const zip=await writer.close();
  const source=await openZip(zip,signal);await importPlaylist(client,source,signal,p=>{report.textContent=p.label;});await source.close();
  const chunks:Uint8Array<ArrayBuffer>[]=[];await exportPlaylist(client,bundle.collection.path,new WritableStream({write:c=>{chunks.push(Uint8Array.from(c));}}),signal,()=>{});
  const exported=await openZip(new Blob(chunks),signal),files:File[]=[];
  for(const asset of bundleAssets(exported.bundle)){const blob=await exported.read(asset,signal);if(await digest(blob)!==asset.sha256)throw new Error('Bytes changed');const file=new File([blob],asset.path);Object.defineProperty(file,'webkitRelativePath',{value:`Playlist/${asset.path}`});files.push(file);}
  const manifest=new File([JSON.stringify(exported.bundle)],MANIFEST);Object.defineProperty(manifest,'webkitRelativePath',{value:`Playlist/${MANIFEST}`});files.push(manifest);
  const folder=await openFolder(files,signal);const result=await importPlaylist(client,folder,signal,()=>{});await exported.close();await folder.close();
  report.textContent=`PASS: real browser IndexedDB; ZIP imported two songs; export bytes verified; extracted folder accepted (${result.skipped} already ready). No extension or model used. Open catalog to test playback.`;
 }catch(error){report.textContent=`FAIL: ${error instanceof Error?error.stack:error}`;}finally{button.disabled=false;}
};

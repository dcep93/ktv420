import { MP3_NAMES, mp3Layout, type Mp3Files } from '../audio/mp3Types';
import type { LocalTrack } from '../library';
import type { PlaybackRecord } from '../../stems/player/types';
import type { Collection } from '../savedCollections';
import { captureStartSeconds } from '../captureAlignment';
import { archiveWriter, type PackageSource } from './archive';
import { MANIFEST, MAX_ART, MAX_AUDIO, MAX_MANIFEST, artworkUrl, digest, parseBundle, raster, type Asset, type Bundle, type BundleTrack } from './manifest';
export type TransferClient = {request:<T>(method:string,args?:unknown[])=>Promise<T>};
export type Progress = {song:number;songs:number;bytes:number;total:number;label:string};
export type Report = (value:Progress)=>void;
async function fetchArtwork(url:string,signal:AbortSignal):Promise<Blob|undefined> {
  if (!url) return;
  try {
    const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
    if(!response.ok || !response.body) return;
    const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ART)throw new Error('Cover too large');chunks.push(Uint8Array.from(value));}}
    finally {await reader.cancel();}
    return await raster(new Blob(chunks));
  } catch {signal.throwIfAborted();return;}
}
export async function exportPlaylist(client:TransferClient,path:string,output:WritableStream<Uint8Array>,signal:AbortSignal,report:Report) {
  const {collection,bytes:total}=await client.request<{collection:Collection;bytes:number}>('exportCollection',[path]);
  const writer=archiveWriter(output); const tracks:BundleTrack[]=[];let bytes=0,missingArtwork=0;
  const asset=async(path:string,blob:Blob,song:number,label:string):Promise<Asset>=>{
    signal.throwIfAborted(); if(blob.size>MAX_AUDIO)throw new Error('Audio file exceeds 256 MiB.');
    report({song,songs:collection.trackIds.length,bytes,total,label:`Checking ${label}`});
    const sha256=await digest(blob);signal.throwIfAborted();
    await writer.add(path,blob,signal,done=>report({song,songs:collection.trackIds.length,bytes:bytes+done,total,label}));
    bytes+=blob.size;return {path,bytes:blob.size,sha256};
  };
  for(const [index,id] of [...new Set(collection.trackIds)].entries()) {
    signal.throwIfAborted();
    const {track,record}=await client.request<{track:LocalTrack;record:PlaybackRecord}>('exportTrack',[id]);
    const files={} as BundleTrack['files'];
    for(const name of MP3_NAMES){const file=record.files.find(file=>file.name===`${name}.mp3`);if(!file)throw new Error(`Missing ${name} for ${track.title}`);files[name]=await asset(`tracks/${id}/${name}.mp3`,file.blob,index+1,`${track.title} · ${name}`);}
    const url=artworkUrl(track.metadata?.trackArtworkSrc) || artworkUrl(collection.artwork);
    const cover=record.artwork || await fetchArtwork(url,signal);
    if(url && !cover)missingArtwork++;
    tracks.push({id,...(track.metadata ? {metadata:track.metadata} : {}),title:track.title,artist:track.artist,sampleRate:track.sampleRate,frames:track.frames,encoding:{...mp3Layout(track.sampleRate,track.frames),gain:record.playbackGain ?? 1},crop:`${captureStartSeconds(track.metadata)}-0`,artworkUrl:url,files,
      ...(cover ? {artwork:await asset(`tracks/${id}/artwork`,await raster(cover),index+1,`${track.title} · artwork`)} : {})});
  }
  const bundle:Bundle=parseBundle({format:'ktv420-playlist',version:2,collection,tracks});
  const manifest=new Blob([JSON.stringify(bundle)]);
  if(manifest.size>MAX_MANIFEST)throw new Error('Playlist manifest exceeds 16 MiB.');
  await writer.add(MANIFEST,manifest,signal);await writer.close(signal);
  report({song:tracks.length,songs:tracks.length,bytes,total:bytes,label:'Export complete'});
  return {bundle,missingArtwork};
}
export async function importPlaylist(client:TransferClient,source:PackageSource,signal:AbortSignal,report:Report) {
  const bundle=source.bundle;
  signal.throwIfAborted();
  const existing=new Set(await client.request<string[]>('beginImport',[bundle]));
  const total=bundle.tracks.reduce((sum,t)=>sum+Object.values(t.files).reduce((n,a)=>n+a.bytes,0)+(t.artwork?.bytes||0),0);
  let bytes=0,saved=0,skipped=0;
  for (const [index,track] of bundle.tracks.entries()) {
    signal.throwIfAborted();const size=Object.values(track.files).reduce((n,a)=>n+a.bytes,0)+(track.artwork?.bytes||0);
    if(existing.has(track.id)){bytes+=size;skipped++;report({song:index+1,songs:bundle.tracks.length,bytes,total,label:`Already ready · ${track.title}`});continue;}
    const files={} as Mp3Files;
    const read=async(asset:Asset)=>{const blob=await source.read(asset,signal,done=>report({song:index+1,songs:bundle.tracks.length,bytes:bytes+done,total,label:`Reading ${track.title}`}));bytes+=asset.bytes;return blob;};
    for(const name of MP3_NAMES)files[name]=await read(track.files[name]);
    const artwork=track.artwork?await read(track.artwork):null;
    signal.throwIfAborted();report({song:index+1,songs:bundle.tracks.length,bytes,total,label:`Verifying and saving ${track.title}`});
    const result=await client.request<'saved'|'skipped'>('importTrack',[{track,collection:bundle.collection},files,artwork]);
    if(result==='saved')saved++;else skipped++;
    signal.throwIfAborted();
  }
  report({song:bundle.tracks.length,songs:bundle.tracks.length,bytes,total,label:'Import complete'});
  return {saved,skipped,path:bundle.collection.path};
}

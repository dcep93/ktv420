import { renderSection, type RenderSource } from './src/features/local/export/render';
import { exportReplay } from './src/features/local/export/exportReplay';
import { compileExport, EXPORT_RATE as rate } from './src/features/local/export/timeline';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import { applyAudioEffect, createEffectNodes, audioEffectOptions } from './src/features/stems/player/audioEffects';
import { connectStemEffects, disposeStemEffects } from './src/features/stems/player/stemGraph';
import { getLogarithmicVolumeGain } from './src/features/stems/player/mixerGain';
import type { MixerSnapshot, PerformanceRecording } from './src/features/local/recording';
import type { LocalTrack } from './src/features/local/library';
const report=document.querySelector('#report')!;
const id='1111111111111111111111',other='2222222222222222222222';
let controller:AbortController|null=null;
const results:string[]=[];
const show=(value:unknown)=>report.textContent=JSON.stringify(value,null,2);
const assert=(ok:boolean,message:string)=>{if(!ok)throw Error(message);results.push(message);show({running:true,results});};
const rms=(d:Float32Array,a:number,b:number)=>{let sum=0;for(let i=Math.round(a*rate);i<Math.round(b*rate);i++)sum+=d[i]*d[i];return Math.sqrt(sum/((b-a)*rate));};
const frequency=(d:Float32Array,a:number,b:number)=>{let n=0;for(let i=Math.round(a*rate)+1;i<Math.round(b*rate);i++)if(d[i-1]<0 && d[i]>=0)n++;return n/(b-a);};
function source(seconds=8,count=1): {source:RenderSource;snapshot:MixerSnapshot;track:LocalTrack} {
 const names=['drums.mp3','bass.mp3','other.mp3','vocals.mp3','input.mp3'].slice(0,count);
 const snapshot:MixerSnapshot={tempo:1,pitch:0,visualizer:'time-ribbon',spotlight:null,stems:names.map(name=>({name,input:name==='input.mp3',volume:1,mute:name==='input.mp3',deafen:false,effect:'wah',value:.5}))};
 const files=names.map((name,index)=>{
  const left=Float32Array.from({length:seconds*rate},(_,i)=>.04*Math.sin(2*Math.PI*(220+index*110)*i/rate));
  const right=Float32Array.from({length:left.length},(_,i)=>.03*Math.sin(2*Math.PI*(330+index*110)*i/rate));
  return {name,path:`spotify-${id}/${name==='input.mp3'?'input':'output'}/${name}`,blob:new Blob([encodeFloat32Wav({left,right,sampleRate:rate})],{type:'audio/wav'})};
 });
 return {source:{record:{md5:`spotify-${id}`,files},offset:0,duration:seconds},snapshot,track:{id:`spotify-${id}`,title:'Synthetic song',artist:'ktv420 fixture',source:'spotify',createdAt:0,status:'ready',sampleRate:rate,frames:seconds*rate,bytes:files.reduce((sum,file)=>sum+file.blob.size,0)}};
}
function mix(snapshot:MixerSnapshot,seconds=4):PerformanceRecording {return {version:3,name:'Export test',createdAt:'2026-10-14',spotifyPath:`playlist/${id}`,tracks:[{id,title:'Synthetic song',duration:8}],events:[
 {at:0,type:'track',trackId:id,position:0,snapshot},{at:0,type:'play',trackId:id,position:0},{at:seconds,type:'stop',trackId:id,position:Math.min(8,seconds)}]};}
function storage(data:ReturnType<typeof source>) {return {
 listTracks:async()=>[data.track,{...data.track,id:`spotify-${other}`}],
 getPlaybackRecord:async()=>data.source.record,
 withProcessingLock:async<T>(run:(value:boolean)=>Promise<T>)=>run(true),
};}
document.querySelector('#cancel')!.addEventListener('click',()=>controller?.abort());
document.querySelector('#correctness')!.addEventListener('click',async()=>{
 results.length=0;controller=new AbortController();const signal=controller.signal;
 try {
  const data=source(),recording=mix(data.snapshot);
  recording.events.splice(2,0,{at:1,type:'pause',trackId:id,position:1},{at:2,type:'play',trackId:id,position:3},{at:3,type:'seek',trackId:id,position:.5});
  const rendered=await renderSection(compileExport(recording).sections[0],data.source,signal,()=>{});
  assert(rendered.length===4*rate,'Output preserves the complete performance timeline');
  assert(rms(rendered.getChannelData(0),1.2,1.8)<1e-7,'Recorded pause stays silent');
  assert(Math.abs(frequency(rendered.getChannelData(0),2.2,2.8)-220)<2,'Resume and seek preserve source pitch');
  assert(Math.abs(frequency(rendered.getChannelData(1),2.2,2.8)-330)<2,'Stereo channels remain independent');
  for(const effect of audioEffectOptions) {
   const snapshot=structuredClone(data.snapshot);snapshot.stems[0].effect=effect.value;snapshot.stems[0].value=.72;snapshot.stems[0].volume=.9;
   const output=await renderSection(compileExport(mix(snapshot,1.5)).sections[0],data.source,signal,()=>{});
   const reference=new OfflineAudioContext(2,Math.round(1.5*rate),rate),input=reference.createGain(),nodes=createEffectNodes(reference);
   input.gain.value=getLogarithmicVolumeGain(.9);connectStemEffects(input,nodes,reference.destination);
   applyAudioEffect({context:reference,nodes,effect:effect.value,value:.72});
   const native=reference.createBufferSource();native.buffer=await reference.decodeAudioData(await data.source.record.files[0].blob.arrayBuffer());native.connect(input);native.start(.02);
   const baseline=await reference.startRendering();let error=0,maxAt=0;
   for(let c=0;c<2;c++){const a=output.getChannelData(c),b=baseline.getChannelData(c);for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>error){error=Math.abs(a[i]-b[i]);maxAt=i/rate;}}
   disposeStemEffects(input,nodes);assert(error<1e-6,`${effect.label}: export matches the live effect graph (${error.toExponential(1)} at ${maxAt}, rms ${rms(output.getChannelData(0),.2,1.2)}/${rms(baseline.getChannelData(0),.2,1.2)})`);
  }
  const pitched=structuredClone(data.snapshot);pitched.tempo=1.5;pitched.pitch=12;
  const output=await renderSection(compileExport(mix(pitched,4)).sections[0],data.source,signal,()=>{});
  assert(Math.abs(frequency(output.getChannelData(0),1,3)-440)<2,'Independent tempo and pitch use the actual playback processor');
  const changing=mix(data.snapshot,4),shifted=structuredClone(data.snapshot);shifted.tempo=.75;shifted.pitch=12;
  changing.events.splice(2,0,{at:2,type:'mix',trackId:id,position:2,snapshot:shifted});
  const changed=await renderSection(compileExport(changing).sections[0],data.source,signal,()=>{});
  assert(Math.abs(frequency(changed.getChannelData(0),.5,1.5)-220)<2 && Math.abs(frequency(changed.getChannelData(0),2.5,3.5)-440)<2,'Mid-song pitch and tempo automation take effect at the scheduled time');
  const markers=source(),samples=Float32Array.from({length:8*rate},(_,i)=>.04*Math.sin(2*Math.PI*(i<4*rate?220:660)*i/rate));
  markers.source.record.files[0].blob=new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:rate})]);
  const seeking=mix(markers.snapshot,4);seeking.events.splice(2,0,{at:1,type:'seek',trackId:id,position:5},{at:2,type:'seek',trackId:id,position:0});
  const sought=await renderSection(compileExport(seeking).sections[0],markers.source,signal,()=>{});
  assert(Math.abs(frequency(sought.getChannelData(0),1.3,1.8)-660)<2 && Math.abs(frequency(sought.getChannelData(0),2.3,2.8)-220)<2,'Forward and backward seeks select the recorded source positions');
  const fade=mix(data.snapshot,3),quiet=structuredClone(data.snapshot);quiet.stems[0].volume=.5;
  fade.events.splice(2,0,{at:1,type:'mix',trackId:id,position:1,snapshot:quiet});
  const faded=await renderSection(compileExport(fade).sections[0],data.source,signal,()=>{});
  assert(Math.abs(rms(faded.getChannelData(0),1.5,2.5)/rms(faded.getChannelData(0),.2,.8)-getLogarithmicVolumeGain(.5))<.001,'Fader automation uses logarithmic gain and smoothing');
  const two=mix(data.snapshot,4);two.tracks.push({id:other,title:'Second',duration:8});two.events.splice(2,0,{at:2,type:'track',trackId:other,position:0,snapshot:data.snapshot},{at:2,type:'play',trackId:other,position:0});two.events.at(-1)!.trackId=other;
  const blob=await exportReplay(two,signal,()=>{},storage(data));
  const decoder=new OfflineAudioContext(2,1,rate),decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
  assert(decoded.length===4*rate,'A two-song MP3 decodes to the exact timeline length');
  assert(rms(decoded.getChannelData(0),2.2,3.5)>.02,'Second song is audible after continuous MP3 encoding');
  const cancelling=new AbortController();let cancelled=false;
  try {await exportReplay(mix(data.snapshot,8),cancelling.signal,p=>{if(p.fraction>.05)cancelling.abort();},storage(data));}catch(e){cancelled=(e as Error).name==='AbortError';}
  assert(cancelled,'Cancel stops the export without producing a partial MP3');
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('ktv420-export');let scratch=false;try{await dir.getFileHandle('mix.pcm');scratch=true;}catch{ /* missing scratch is expected */ }
  assert(!scratch,'Temporary PCM is removed after cancellation');
  const encodingCancel=new AbortController();let encodingCancelled=false;
  try {await exportReplay(mix(data.snapshot,8),encodingCancel.signal,p=>{if(p.phase==='encoding' && p.fraction>.8)encodingCancel.abort();},storage(data));}catch(e){encodingCancelled=(e as Error).name==='AbortError';}
  assert(encodingCancelled,'Cancel terminates active MP3 encoding');
  scratch=false;try{await dir.getFileHandle('mix.pcm');scratch=true;}catch{ /* missing scratch is expected */ }
  assert(!scratch,'Temporary PCM is removed after encoder cancellation');
  await exportReplay(mix(data.snapshot,1),signal,()=>{},storage(data));assert(true,'A new export succeeds after cancellation');
  show({passed:true,results});
 }catch(error){show({passed:false,error:String(error),results});}finally{controller=null;}
});
document.querySelector('#benchmark')!.addEventListener('click',async()=>{
 controller=new AbortController();const started=performance.now();
 try {
  const data=source(8,5),recording=mix(data.snapshot,300);
  recording.events=recording.events.slice(0,2);
  for(let at=2;at<300;at+=2){const snapshot=structuredClone(data.snapshot);snapshot.tempo=at%8===0?.75:1.25;snapshot.pitch=at%12===0?-3:3;snapshot.stems[0].effect='reverb';snapshot.stems[0].value=.35;snapshot.stems[1].effect='delay-pedal';snapshot.stems[1].value=.3;snapshot.stems[2].volume=at%6===0?.8:1;
    recording.events.push({at,type:'seek',trackId:id,position:0},{at,type:'mix',trackId:id,position:0,snapshot});}
  recording.events.push({at:300,type:'stop',trackId:id,position:2});
  const blob=await exportReplay(recording,controller.signal,p=>show({running:true,elapsedSeconds:(performance.now()-started)/1000,...p}),storage(data));
  const elapsedSeconds=(performance.now()-started)/1000;
  const decoder=new OfflineAudioContext(2,1,rate),decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
  const levels=Array.from({length:300},(_,second)=>rms(decoded.getChannelData(0),second+.1,second+.9));
  show({passed:decoded.length===300*rate && Math.min(...levels)>.005,audioSeconds:decoded.duration,elapsedSeconds,speed:300/elapsedSeconds,minRms:Math.min(...levels),mp3Bytes:blob.size,bitrateKbps:blob.size*8/300/1000});
 }catch(error){show({passed:false,error:String(error)});}finally{controller=null;}
});

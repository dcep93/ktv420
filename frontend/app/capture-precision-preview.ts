import mp3 from '@audio/encode-mp3';
import hookUrl from '../../extension/src/page/spotifyHooks.js?url';
import workletUrl from '../../extension/src/page/pcmWorklet.js?url';
import {encodeFloat32Wav} from './src/features/local/audio/wav';
import {startPreciseCapture,captureTiming} from '../../extension/src/content/preciseCapture.js';
const audio=document.querySelector<HTMLAudioElement>('#audio')!,result=document.querySelector('#result')!;
type CaptureResult = { target: { currentTime: number }; bytesBuffer: ArrayBuffer; sampleRate: number; invalid: boolean; invalidReason: string };
const hook=document.createElement('script');hook.src=hookUrl;hook.dataset.ktv420WorkletUrl=workletUrl;
hook.onload=()=>{document.querySelector<HTMLButtonElement>('#run')!.disabled=false;};document.head.append(hook);
let sequence=0;
function command(command:string,payload={}){return new Promise<CaptureResult>((resolve,reject)=>{const commandId=++sequence;const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('command timeout '+command));},5000);const listener=(event:MessageEvent)=>{const d=event.data;if(d?.source!=='ktv420_page_hooks'||d?.payload?.commandId!==commandId)return;clearTimeout(timer);window.removeEventListener('message',listener);if(d.payload.ok)resolve(d.payload.result);else reject(new Error(d.payload.error));};window.addEventListener('message',listener);window.postMessage({source:'ktv420_content',commandId,command,payload},location.origin);});}
document.querySelector('#run')!.addEventListener('click',async()=>{
 try{
  result.textContent='Testing…';await command('listening-enable',{enabled:true});
  const compressed=document.querySelector<HTMLInputElement>('#mp3-test')!.checked;
  const sampleRate=compressed?44100:48000,frames=Math.round(sampleRate*3.137),left=new Float32Array(frames),right=new Float32Array(frames);
  // Known leading silence followed by a ramp exposes both lost and inserted samples.
  for(let i=0;i<frames;i++){left[i]=i<1024?0:.1+.4*i/frames;right[i]=i<1024?0:-.1-.3*i/frames;}
  let blob=new Blob([encodeFloat32Wav({left,right,sampleRate},2)],{type:'audio/wav'});
  if(compressed){
   const encoder=await mp3({sampleRate,channels:2,bitrate:320});
   try { const body=new Blob([new Uint8Array(encoder.encode([left,right])),new Uint8Array(encoder.flush())],{type:'audio/mpeg'});const head=encoder.head!();blob=new Blob([new Uint8Array(head),body.slice(head.length)],{type:'audio/mpeg'}); }
   finally {encoder.free();}
  }
  const referenceContext=new AudioContext();
  const reference=await referenceContext.decodeAudioData(await blob.arrayBuffer());
  const referenceLeft=reference.getChannelData(0),referenceRight=reference.getChannelData(1);
  await referenceContext.close();
  audio.src=URL.createObjectURL(blob);
  await new Promise(resolve=>audio.addEventListener('canplaythrough',resolve,{once:true}));
  audio.currentTime=1;await new Promise(resolve=>audio.addEventListener('seeked',resolve,{once:true}));
  const bridge={command};
  const start=await startPreciseCapture({bridge,trackId:'test',readTransport:()=>({trackId:'test'}),transport:async c=>{
   if(c.action==='pause')audio.pause();
   if(c.action==='seek'){audio.currentTime=0;await new Promise(resolve=>audio.addEventListener('seeked',resolve,{once:true}));}
   if(c.action==='play')await audio.play();
  }});
  if(document.querySelector<HTMLInputElement>('#busy-test')!.checked)setTimeout(()=>{const until=performance.now()+200;while(performance.now()<until){ /* simulate main-thread contention */ }},1800);
  if(document.querySelector<HTMLInputElement>('#end-delay-test')!.checked)setTimeout(()=>{const until=performance.now()+350;while(performance.now()<until){ /* delay ended event delivery */ }},3050);
  if(document.querySelector<HTMLInputElement>('#pause-test')!.checked)setTimeout(()=>{audio.pause();setTimeout(()=>void audio.play(),250);},800);
  await new Promise(resolve=>audio.addEventListener('ended',resolve,{once:true}));
  const capture=await command('capture-finish');const pcm=new Float32Array(capture.bytesBuffer);
  const first=pcm.findIndex(value=>Math.abs(value)>.001);let last=pcm.length-1;while(last>=0&&Math.abs(pcm[last])<.001)last--;
  let maxError=0;for(let i=0;i<Math.min(reference.length,pcm.length/2);i++){maxError=Math.max(maxError,Math.abs(referenceLeft[i]-pcm[i*2]),Math.abs(referenceRight[i]-pcm[i*2+1]));}
  let audit;try{audit=captureTiming(capture,audio.duration);}catch(e){audit=String(e);}
  result.textContent=JSON.stringify({start:start.target,rate:capture.sampleRate,frames:pcm.length/2,duration:pcm.length/2/capture.sampleRate,firstSignalFrame:first/2,lastSignalFrame:Math.floor(last/2),firstLeft:pcm[first],lastLeft:pcm[last-1],invalid:capture.invalid,invalidReason:capture.invalidReason,maxError,expectedFrames:reference.length,mediaDuration:audio.duration,referenceDuration:reference.duration,audit},null,2);
 }catch(e){result.textContent=String(e);}
});

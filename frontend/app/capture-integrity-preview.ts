import mp3 from '@audio/encode-mp3';
import hookUrl from '../../extension/src/page/spotifyHooks.js?url';
import workletUrl from '../../extension/src/page/pcmWorklet.js?url';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import { startPreciseCapture, captureTiming } from '../../extension/src/content/preciseCapture.js';
const audio=document.querySelector<HTMLAudioElement>('#audio')!;
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,run=document.querySelector<HTMLButtonElement>('#run')!;
type CaptureResult={bytesBuffer:ArrayBuffer;sampleRate:number;channelCount:number;byteLength:number;invalid:boolean;invalidReason:string;mediaDuration:number;target:{duration:number}};
let probeChunks:Float32Array[]=[],probeContext:AudioContext|undefined;
// Independent, uninterrupted tap before collector interval selection. This
// distinguishes collector clipping from the browser's own resampler behavior.
const nativeSource=AudioContext.prototype.createMediaElementSource;
AudioContext.prototype.createMediaElementSource=function(element){
 const source=nativeSource.call(this,element);probeContext=source.context as AudioContext;
 const probe=new AudioWorkletNode(this,'ktv420-pcm-capture',{numberOfInputs:1,numberOfOutputs:0,channelCount:2,channelCountMode:'explicit'});
 probe.port.onmessage=event=>{if(event.data.bytesBuffer)probeChunks.push(new Float32Array(event.data.bytesBuffer));};
 source.connect(probe);return source;
};
const hook=document.createElement('script');hook.src=hookUrl;hook.dataset.ktv420WorkletUrl=workletUrl;
hook.onload=()=>{run.disabled=false;status.textContent='Ready — output muted';};document.head.append(hook);
let sequence=0;
function command(command:string,payload={}){return new Promise<CaptureResult>((resolve,reject)=>{
 const commandId=++sequence,timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error(command+' timed out'));},8000);
 const listener=(event:MessageEvent)=>{const d=event.data;if(d?.source!=='ktv420_page_hooks'||d?.payload?.commandId!==commandId)return;clearTimeout(timer);window.removeEventListener('message',listener);if(d.payload.ok)resolve(d.payload.result);else reject(new Error(d.payload.error));};
 window.addEventListener('message',listener);window.postMessage({source:'ktv420_content',commandId,command,payload},location.origin);
});}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const once=(target:EventTarget,name:string)=>new Promise<Event>((resolve,reject)=>{const timer=setTimeout(()=>{target.removeEventListener(name,listener);reject(new Error(name+' timed out'));},12000);const listener=(event:Event)=>{clearTimeout(timer);resolve(event);};target.addEventListener(name,listener,{once:true});});
function signal(rate:number,seconds:number){
 const frames=Math.round(rate*seconds),left=new Float32Array(frames),right=new Float32Array(frames);
 let seed=123456789,a=0,b=0;
 for(let i=0;i<frames;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  a=.72*a+.28*((seed/4294967296)*2-1);b=.72*b+.28*a;
  left[i]=b*.7;right[i]=.3*Math.sin(2*Math.PI*(300*i/rate+1200*(i/rate)**2));
 }
 return {left,right,sampleRate:rate};
}
async function encode(rate:number,kind:string){
 const source=signal(rate,3.137);
 if(kind==='wav')return new Blob([encodeFloat32Wav(source,2)],{type:'audio/wav'});
 const encoder=await mp3({sampleRate:rate,channels:2,bitrate:320});
 try{const body=new Blob([new Uint8Array(encoder.encode([source.left,source.right])),new Uint8Array(encoder.flush())],{type:'audio/mpeg'});const head=encoder.head!();return new Blob([new Uint8Array(head),body.slice(head.length)],{type:'audio/mpeg'});}finally{encoder.free();}
}
// Match independent reference windows to detect missing beginnings/endings.
function alignment(reference:Float32Array,recorded:Float32Array,rate:number,start:number,length:number){
 let best={lag:0,correlation:-2,rmse:Infinity};
 const compare=(lag:number,stride:number)=>{
  let dot=0,aa=0,bb=0,error=0;
  for(let i=start;i<start+length;i+=stride){const j=i+lag;if(j<0||j>=recorded.length)return null;const a=reference[i],b=recorded[j];dot+=a*b;aa+=a*a;bb+=b*b;error+=(a-b)**2;}
  return{lag,correlation:dot/Math.sqrt(aa*bb),rmse:Math.sqrt(error/(length/stride))};
 };
 const radius=Math.max(Math.round(rate*.09),Math.abs(recorded.length-reference.length)+Math.round(rate*.09));
 for(let lag=-radius;lag<=radius;lag+=8){const candidate=compare(lag,4);if(candidate&&candidate.correlation>best.correlation)best=candidate;}
 const coarse=best.lag;
 for(let lag=coarse-9;lag<=coarse+9;lag++){const candidate=compare(lag,1);if(candidate&&candidate.correlation>best.correlation)best=candidate;}
 return{...best,lagMs:best.lag/rate*1000};
}
const reports:unknown[]=[];
async function test(rate:number,kind:string,mode:string){
 probeChunks=[];let pausedFrames=0;
 await command('capture-abort');await command('listening-enable',{enabled:true});await command('listening-output',{gain:0});
 const blob=await encode(rate,kind),decodeContext=new AudioContext();
 const decoded=await decodeContext.decodeAudioData(await blob.arrayBuffer());await decodeContext.close();
 const ref=decoded.getChannelData(0).slice();
 let url='';const timers:ReturnType<typeof setTimeout>[]=[];const events:{event:string,time:number}[]=[];
 const recordEvent=(e:Event)=>events.push({event:e.type,time:audio.currentTime});
 for(const name of ['waiting','playing','pause','ended','durationchange'])audio.addEventListener(name,recordEvent);
 try{
  if(kind==='mse'){
   if(!MediaSource.isTypeSupported('audio/mpeg'))throw new Error('MSE audio/mpeg unsupported');
   const media=new MediaSource();url=URL.createObjectURL(media);const opened=once(media,'sourceopen');audio.src=url;await opened;
   const buffer=media.addSourceBuffer('audio/mpeg'),bytes=new Uint8Array(await blob.arrayBuffer());
   const split=mode==='buffering'?Math.floor(bytes.length*.45):bytes.length;
   let updated=once(buffer,'updateend');buffer.appendBuffer(bytes.slice(0,split));await updated;
   if(mode==='buffering'){
    media.duration=decoded.duration+.1;
    timers.push(setTimeout(async()=>{try{updated=once(buffer,'updateend');buffer.appendBuffer(bytes.slice(split));await updated;media.endOfStream();}catch(e){events.push({event:String(e),time:audio.currentTime});}},2400));
   }else media.endOfStream();
  }else{url=URL.createObjectURL(blob);audio.src=url;}
  for(let i=0;audio.readyState<3&&i<120;i++)await sleep(25);
  if(audio.readyState<3)throw new Error('source did not become ready');
  audio.pause();
  const transport=async(c:{action:string})=>{
   if(c.action==='pause')audio.pause();
   if(c.action==='seek'){const seeked=once(audio,'seeked');audio.currentTime=0;await seeked;}
   if(c.action==='play')await audio.play();
  };
  const ended=once(audio,'ended');
  const start=await startPreciseCapture({bridge:{command},trackId:'fixture',readTransport:()=>({trackId:'fixture'}),transport});
  if(mode==='pause')timers.push(setTimeout(()=>{const at=probeContext!.currentTime;audio.pause();timers.push(setTimeout(()=>{pausedFrames=Math.round((probeContext!.currentTime-at)*probeContext!.sampleRate);void audio.play();},180));},1100));
  if(mode==='busy')timers.push(setTimeout(()=>{const until=performance.now()+350;while(performance.now()<until){/* delay main thread only */}},3000));
  await ended;
  const capture=await command('capture-finish');await sleep(20);
  const interleaved=new Float32Array(capture.bytesBuffer),pcm=new Float32Array(interleaved.length/2);
  for(let i=0;i<pcm.length;i++)pcm[i]=interleaved[i*2];
  const len=Math.round(capture.sampleRate*.02);
  const windows={head:alignment(ref,pcm,capture.sampleRate,0,len),early:alignment(ref,pcm,capture.sampleRate,Math.round(capture.sampleRate*.05),len),middle:alignment(ref,pcm,capture.sampleRate,Math.round(capture.sampleRate*1.7),len),tail:alignment(ref,pcm,capture.sampleRate,ref.length-len,len)};
  let audit:unknown;try{audit=captureTiming(capture,start.target.duration);}catch(e){audit=String(e);}
  const nativePcm=new Float32Array(probeChunks.reduce((n,c)=>n+c.length/2,0));let offset=0;
  for(const chunk of probeChunks)for(let i=0;i<chunk.length;i+=2)nativePcm[offset++]=chunk[i];
  const nativeWindows={head:alignment(ref,nativePcm,capture.sampleRate,0,len),tail:alignment(ref,nativePcm,capture.sampleRate,ref.length-len,len)};
  const collectorDriftMs=windows.tail.lagMs-windows.head.lagMs;
  const nativeDriftMinusPauseMs=nativeWindows.tail.lagMs-nativeWindows.head.lagMs-pausedFrames/capture.sampleRate*1000;
  const boundariesPreserved=windows.head.correlation>.98&&windows.tail.correlation>.98;
  return{rate,kind,mode,accepted:!capture.invalid&&typeof audit!=='string',boundariesPreserved,windows,nativeWindows,collectorDriftMs,nativeDriftMinusPauseMs,frames:pcm.length,referenceFrames:ref.length,startDuration:start.target.duration,finalDuration:capture.mediaDuration,invalidReason:capture.invalidReason,audit,events};
 }finally{
  for(const timer of timers)clearTimeout(timer);
  await command('capture-abort');audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
  for(const name of ['waiting','playing','pause','ended','durationchange'])audio.removeEventListener(name,recordEvent);
 }
}
run.addEventListener('click',async()=>{
 run.disabled=true;reports.length=0;
 const cases=[44100,48000].flatMap(rate=>['wav','mp3','mse'].flatMap(kind=>['normal','pause','busy',...(kind==='mse'?['buffering']:[])].map(mode=>({rate,kind,mode}))));
 for(const [i,c]of cases.entries()){
  status.textContent=`Muted test ${i+1}/${cases.length}: ${c.kind} ${c.rate} Hz ${c.mode}`;
  try{reports.push(await test(c.rate,c.kind,c.mode));}catch(e){reports.push({...c,error:String(e)});}
  result.textContent=JSON.stringify(reports,null,2);
 }
 status.textContent='Complete — '+cases.length+' muted tests';run.disabled=false;
});

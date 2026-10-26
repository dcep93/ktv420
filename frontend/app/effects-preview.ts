// Dev-only exercise of production worklets and replay render; no audible output/storage.
import { applyAudioEffect, createEffectNodes, prepareAudioEffects, disposeAudioEffects, type AudioEffectType } from './src/features/stems/player/audioEffects';
import { renderSection } from './src/features/local/export/render';
import { compileExport } from './src/features/local/export/timeline';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { PerformanceRecording } from './src/features/local/recording';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const result=document.querySelector('#result')!;
const rate=48000;
function amplitude(data:Float32Array,frequency:number,start=rate){let re=0,im=0;for(let i=start;i<data.length;i++){const phase=2*Math.PI*frequency*i/rate;re+=data[i]*Math.cos(phase);im+=data[i]*Math.sin(phase);}return 2*Math.hypot(re,im)/(data.length-start);}
async function render(effect:AudioEffectType,amount:number,count=1,seconds=3){
  const context=new OfflineAudioContext(count*2,Math.round(seconds*rate),rate);
  await prepareAudioEffects(context);
  const merger=context.createChannelMerger(count*2);merger.connect(context.destination);
  const nodes=[];
  for(let index=0;index<count;index++){
    const buffer=context.createBuffer(2,context.length,rate);
    for(let channel=0;channel<2;channel++){const data=buffer.getChannelData(channel),frequency=channel?330:440;for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(2*Math.PI*frequency*i/rate);}
    const source=context.createBufferSource();source.buffer=buffer;
    const effects=createEffectNodes(context),split=context.createChannelSplitter(2);
    source.connect(effects.node);effects.node.connect(split);split.connect(merger,0,index*2);split.connect(merger,1,index*2+1);
    applyAudioEffect({context,nodes:effects,effect,value:amount});source.start();nodes.push(effects);
  }
  const start=performance.now(),audio=await context.startRendering(),ms=performance.now()-start;
  nodes.forEach(disposeAudioEffects);
  return {audio,ms,fraction:ms/1000/seconds};
}
document.querySelector('#run')!.addEventListener('click',async()=>{
  const checks:string[]=[],benchmarks:unknown[]=[];
  const show=(value:unknown)=>result.textContent=JSON.stringify(value,null,2);
  const assert=(value:boolean,label:string)=>{if(!value)throw Error(label);checks.push(label);show({running:true,checks,benchmarks});};
  try{
    for(const [amount,ratio] of [[0,.5],[1,2]]){
      const {audio}=await render('octave',amount);
      assert(amplitude(audio.getChannelData(0),440*ratio)>.025,`Worklet octave ${ratio}× is audible and in tune`);
      assert(amplitude(audio.getChannelData(1),330*ratio)>.025,`Stereo octave ${ratio}× retains right-channel pitch`);
    }
    const shimmer=await render('shimmer-reverb',1);
    assert(amplitude(shimmer.audio.getChannelData(0),880)>.004,'Shimmer worklet selects the new effect ID and produces an octave-up tail');
    const id='1111111111111111111111';
    for(const effect of ['octave','reverse-echo','shimmer-reverb'] as const){
      const input=Float32Array.from({length:rate*4},(_,i)=>.1*Math.sin(2*Math.PI*440*i/rate));
      const snapshot={tempo:1,pitch:0,visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect,value:.8,effectSettings:{bypass:false,bpm:120,beats:.5}}]};
      const recording:PerformanceRecording={version:3,name:'Effects check',createdAt:'2026-10-26',spotifyPath:`album/${id}`,tracks:[{id,title:'Synthetic',duration:4}],events:[
        {at:0,type:'track',trackId:id,position:0,snapshot},{at:0,type:'play',trackId:id,position:0},
        {at:1,type:'mix',trackId:id,position:1,snapshot:{...snapshot,stems:[{...snapshot.stems[0],value:1}]}},
        {at:3,type:'stop',trackId:id,position:3}]};
      const audio=await renderSection(compileExport(recording).sections[0],{offset:0,duration:4,record:{md5:`spotify-${id}`,files:[{name:'vocals.mp3',path:`spotify-${id}/output/vocals.mp3`,blob:new Blob([encodeFloat32Wav({left:input,right:input,sampleRate:rate})])}]}},new AbortController().signal,()=>{});
      let energy=0;for(const x of audio.getChannelData(0)){if(!Number.isFinite(x))throw Error('Nonfinite replay output');energy+=x*x;}
      assert(audio.duration===3&&energy>1,`${effect}: replay/export renders the correct duration with effect automation`);
    }
    for(const effect of ['reverb','octave','reverse-echo','shimmer-reverb'] as const){
      const runs=[];
      for(let repeat=0;repeat<3;repeat++){const run=await render(effect,1,5,8);runs.push(run.fraction);}
      runs.sort((a,b)=>a-b);benchmarks.push({effect,stereoStems:5,audioSeconds:8,medianRenderMs:Math.round(runs[1]*8000),renderTimeFraction:runs[1],runs});
      assert(runs[1]<.35,`${effect}: five-stem processing retains rendering headroom`);
    }
    show({passed:true,checks,benchmarks});
  }catch(error){show({passed:false,error:String(error),checks,benchmarks});}
});

import { TempoEngine } from './src/features/stems/player/tempoEngine';
import { createMasterAudio, masterLatencyFrames, MASTER_CEILING } from './src/features/stems/player/masterAudio';
import { renderSection } from './src/features/local/export/render';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerSnapshot } from './src/features/local/recording';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const result = document.querySelector('#result')!;
const peak = (samples: Float32Array) => samples.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
const rms = (samples: Float32Array, start: number) => Math.sqrt(samples.subarray(start).reduce((sum, x) => sum + x*x, 0)/(samples.length-start));
document.querySelector('#run')!.addEventListener('click', async () => {
  const checks: string[] = [], measurements: unknown[] = [];
  const show = (extra: object) => { result.textContent = JSON.stringify({checks, measurements, ...extra}, null, 2); };
  const assert = (ok: boolean, label: string) => { if (!ok) throw Error(label); checks.push(label); show({running:true}); };
  async function render(rate: number, signal: (i: number, channel: number) => number, gains = [1], seconds = 1) {
    const context = new OfflineAudioContext(2, Math.round(rate*seconds), rate), master = createMasterAudio(context);
    master.output.connect(context.destination);
    for (const gain of gains) {
      const source = context.createBufferSource(), buffer = context.createBuffer(2, context.length, rate);
      for (let c=0;c<2;c++) { const data=buffer.getChannelData(c); for(let i=0;i<data.length;i++) data[i]=gain*signal(i,c); }
      source.buffer=buffer;source.connect(master.input);source.start();
    }
    const audio=await context.startRendering();master.dispose();return audio;
  }
  try {
    for (const rate of [44100,48000]) {
      const marker=100, delay=masterLatencyFrames(rate);
      const impulse=await render(rate,(i,c)=>i===marker?(c?-.025:.05):0);
      const l=impulse.getChannelData(0),r=impulse.getChannelData(1);
      const first=l.findIndex(x=>Math.abs(x)>1e-8),rightFirst=r.findIndex(x=>Math.abs(x)>1e-8);
      measurements.push({rate,delayFrames:first-marker,delayMs:(first-marker)*1000/rate});
      assert(first===marker+delay&&rightFirst===first,`${rate}: measured master delay matches compensation and L/R remain aligned`);
      assert(Math.abs(l[first]/r[first]+2)<1e-5,`${rate}: quiet stereo proportions are preserved`);
      const silence=await render(rate,()=>0);
      assert(peak(silence.getChannelData(0))===0&&peak(silence.getChannelData(1))===0,`${rate}: silence remains exactly silent`);
      const cancelled=await render(rate,i=>.8*Math.sin(i*2*Math.PI*733/rate),[1,-1]);
      assert(peak(cancelled.getChannelData(0))===0,`${rate}: opposite stems cancel before shared nonlinear processing`);
      const tone=(i:number)=>.15*Math.sin(i*2*Math.PI*733/rate);
      const unity=await render(rate,tone),boosted=await render(rate,tone,[4]);
      const normalRms=rms(unity.getChannelData(0),rate/2),boostRms=rms(boosted.getChannelData(0),rate/2);
      measurements.push({rate,normalRms,boostRms,boostDb:20*Math.log10(boostRms/normalRms),boostPeak:peak(boosted.getChannelData(0))});
      assert(boostRms>normalRms*1.5,`${rate}: fader boost raises sustained loudness`);
      const overload=await render(rate,(i,c)=>(c?-1:1)*(i<10?100:8*Math.sin(i*2*Math.PI*173/rate)),[1,1,1,1,1]);
      assert([...overload.getChannelData(0),...overload.getChannelData(1)].every(Number.isFinite),`${rate}: extreme summed input stays finite`);
      assert(peak(overload.getChannelData(0))<=MASTER_CEILING+1e-6&&peak(overload.getChannelData(1))<=MASTER_CEILING+1e-6,`${rate}: transient and sustained overload remain below -1 dBFS sample ceiling`);
      measurements.push({rate,stereoSymmetryError:overload.getChannelData(0).reduce((max,x,i)=>Math.max(max,Math.abs(x+overload.getChannelData(1)[i])),0)});
      assert(overload.getChannelData(0).every((x,i)=>Math.abs(x+overload.getChannelData(1)[i])<3e-6),`${rate}: opposite-polarity stereo channels remain aligned under overload`);
    }
    // Changing tempo during the scheduled lead-in must not start a stem early.
    const leadRate=48000,leadContext=new OfflineAudioContext(2,leadRate,leadRate),leadMaster=createMasterAudio(leadContext);
    leadMaster.output.connect(leadContext.destination);
    const leadBuffer=leadContext.createBuffer(2,leadRate,leadRate);
    leadBuffer.getChannelData(0)[100]=.02;leadBuffer.getChannelData(1)[100]=.02;
    const engine=await TempoEngine.create(leadContext,[leadBuffer],[leadMaster.input],message=>{throw Error(message);},()=>{},leadMaster.latencySeconds);
    try {
      await engine.start(0);await engine.set(1.5,0);await engine.set(1,0);
      const rendered=await leadContext.startRendering();
      assert(rendered.getChannelData(0).findIndex(x=>Math.abs(x)>1e-8)===960+100+masterLatencyFrames(leadRate),'Tempo toggles during scheduled lead-in preserve sample-aligned start');
    } finally { engine.dispose();leadMaster.dispose(); }
    // Exact sparse markers catch a forgotten delay trim and truncated section tail.
    const rate=44100,frames=rate*2,start=882,firstMarker=500,lastMarker=frames-start-2;
    const data=new Float32Array(rate*3);data[firstMarker]=.02;data[lastMarker]=-.03;
    const snapshot:MixerSnapshot={tempo:1,pitch:0,visualizer:'time-ribbon',spotlight:null,stems:[{name:'drums.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]};
    const audio=await renderSection({trackId:'test',start:0,frames,events:[{type:'track',at:0,trackId:'test',position:0,snapshot},{type:'play',at:0,trackId:'test',position:0},{type:'stop',at:2,trackId:'test',position:2}]},{offset:0,duration:3,record:{md5:'test',files:[{name:'drums.mp3',path:'test/output/drums.mp3',blob:new Blob([encodeFloat32Wav({left:data,right:data,sampleRate:rate})])}]}},new AbortController().signal,()=>{});
    const samples=audio.getChannelData(0);
    assert(audio.length===frames,'Export retains exact requested section length');
    assert(samples.findIndex(x=>Math.abs(x)>1e-8)===start+firstMarker,'Export removes only master latency and preserves transport start scheduling');
    assert(samples[frames-2]<-.01,'Export retains the final delayed marker instead of truncating the tail');
    assert(samples.every((x,i)=>x===audio.getChannelData(1)[i]),'Export keeps stereo markers sample aligned');
    show({passed:true});
  } catch(error) {show({passed:false,error:String(error)});}
});

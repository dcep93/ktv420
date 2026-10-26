import './src/styles/theme.css';
import './src/index.css';
import { drawPitchRibbon } from './src/features/stems/player/visuals/pitchRibbon';
import { pitchWindowSize } from './src/features/stems/player/visuals/pitchAnalysis';
import { drawTimeRibbon } from './src/features/stems/player/visuals/timeRibbon';
import { resizeVisualizer } from './src/features/stems/player/visuals/canvas';
import { AMPLITUDE_WINDOW_SECONDS } from './src/features/stems/player/types';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const voices=[55,220,660].map((base,index)=>{
  const row=document.createElement('section');
  row.innerHTML=`<h3>Signal ${index+1}</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px"><canvas aria-label="Signal ${index+1} pitch" style="width:100%;height:155px"></canvas><canvas aria-label="Signal ${index+1} amplitude" style="width:100%;height:155px"></canvas></div>`;
  document.querySelector('#plots')!.append(row);
  const [pitch,amplitude]=row.querySelectorAll('canvas');
  const observer=new ResizeObserver(()=>{resizeVisualizer(pitch);resizeVisualizer(amplitude);});observer.observe(row);
  return {base,pitch,amplitude};
});
document.querySelector<HTMLButtonElement>('#start')!.addEventListener('click',async event=>{
  (event.target as HTMLButtonElement).disabled=true;
  const context=new AudioContext(),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
  const length=24,notes=[0,2,5,7,4,2,0,-3];
  const tracks=voices.map(voice=>{
    const buffer=context.createBuffer(1,context.sampleRate*length,context.sampleRate),data=buffer.getChannelData(0);
    const envelope=new Array(Math.ceil(length/AMPLITUDE_WINDOW_SECONDS)).fill(0);let phase=0;
    for(let i=0;i<data.length;i++){
      const time=i/context.sampleRate,note=Math.floor(time/.6),within=time%.6;
      const hz=voice.base*2**(notes[note%notes.length]/12);phase+=2*Math.PI*hz/context.sampleRate;
      const rest=(note%4===3&&within>.36),edge=Math.min(1,within/.012,(.6-within)/.012);
      const gain=rest?0:(Math.floor(time/4.8)%2?.025:.07)*edge;
      data[i]=gain*(.5*Math.sin(phase)+.35*Math.sin(phase*2)+.15*Math.sin(phase*3));
      const bin=Math.floor(time/AMPLITUDE_WINDOW_SECONDS);envelope[bin]=Math.max(envelope[bin],Math.abs(data[i]));
    }
    const source=context.createBufferSource(),analyser=context.createAnalyser();analyser.fftSize=pitchWindowSize(context.sampleRate);
    source.buffer=buffer;source.connect(analyser);analyser.connect(sink);source.start();
    return {...voice,analyser,envelope};
  });
  await context.resume();const timings:number[]=[];
  const pause=document.querySelector<HTMLButtonElement>('#pause')!;pause.disabled=false;
  pause.addEventListener('click',async()=>{if(context.state==='running'){await context.suspend();pause.textContent='Resume';}else{await context.resume();pause.textContent='Pause';}});
  function frame(){
    const time=Math.min(length,context.currentTime),playing=context.state==='running'&&time<length,begin=performance.now();
    for(const track of tracks){
      const inputs={canvas:track.pitch,analyser:track.analyser,currentTime:time,duration:length,sampleRate:context.sampleRate,isPlaying:playing,visualizerType:'pitch-ribbon' as const};
      drawPitchRibbon(inputs);
      drawTimeRibbon({...inputs,canvas:track.amplitude,visualizerType:'time-ribbon',amplitudeEnvelope:track.envelope,amplitudeMaximum:.07});
    }
    timings.push(performance.now()-begin);
    if(timings.length===120){const sorted=[...timings].sort((a,b)=>a-b);document.querySelector('#timing')!.textContent=`3 paired panels: mean ${(timings.reduce((a,b)=>a+b,0)/timings.length).toFixed(2)} ms · p95 ${sorted[113].toFixed(2)} ms`;timings.length=0;}
    requestAnimationFrame(frame);
  }
  frame();
});

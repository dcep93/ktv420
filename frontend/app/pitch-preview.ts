import './src/styles/theme.css';
import './src/index.css';
import { drawPitchRibbon } from './src/features/stems/player/visuals/pitchRibbon';
import { PitchTimelineClient } from './src/features/stems/player/visuals/pitchTimelineClient';
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
  return {id:String(index),base,pitch,amplitude};
});
document.querySelector<HTMLButtonElement>('#start')!.addEventListener('click',async event=>{
  (event.target as HTMLButtonElement).disabled=true;
  const context=new AudioContext(),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
  const length=180,notes=[0,2,5,7,4,2,0,-3],started=performance.now();
  const client=new PitchTimelineClient(()=>{
    const ready=voices.every(voice=>client.get(voice.id)?.ready.every(Boolean));
    if(ready)document.querySelector('#prepared')!.textContent=`180 seconds × 3 signals preloaded in ${((performance.now()-started)/1000).toFixed(2)} s`;
  });
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
    const analyser=context.createAnalyser();analyser.fftSize=2048;analyser.connect(sink);
    client.add(voice.id,buffer);return {...voice,analyser,envelope,buffer};
  });
  let playing=false,offset=0,origin=context.currentTime,tempo=1,pitch=0,sources:AudioBufferSourceNode[]=[];
  const position=()=>Math.min(length,offset+(playing?(context.currentTime-origin)*tempo:0));
  const stop=()=>{for(const source of sources)source.stop();sources=[];};
  const play=()=>{origin=context.currentTime;sources=tracks.map(track=>{
    const source=context.createBufferSource();source.buffer=track.buffer;source.playbackRate.value=tempo;
    source.connect(track.analyser);source.start(0,offset);return source;
  });};
  const toggle=document.querySelector<HTMLButtonElement>('#pause')!;toggle.disabled=false;toggle.textContent='Play';
  toggle.addEventListener('click',async()=>{
    await context.resume();offset=position();stop();playing=!playing;if(playing)play();toggle.textContent=playing?'Pause':'Play';
  });
  const seek=document.querySelector<HTMLInputElement>('#seek')!;seek.disabled=false;
  seek.addEventListener('input',()=>{offset=Number(seek.value);stop();client.setTime(offset);if(playing)play();});
  const tuning=document.querySelector<HTMLInputElement>('#pitch')!;tuning.disabled=false;tuning.addEventListener('input',()=>{pitch=Number(tuning.value);});
  const rate=document.querySelector<HTMLSelectElement>('#tempo')!;rate.disabled=false;
  rate.addEventListener('change',()=>{offset=position();stop();tempo=Number(rate.value);if(playing)play();});
  const timings:number[]=[];
  function frame(){
    const time=position(),begin=performance.now();client.setTime(time);
    for(const track of tracks){
      const inputs={canvas:track.pitch,analyser:track.analyser,currentTime:time,duration:length,sampleRate:context.sampleRate,isPlaying:playing,visualizerType:'pitch-ribbon' as const};
      drawPitchRibbon({...inputs,pitchTimeline:client.get(track.id),pitchSemitones:pitch});
      drawTimeRibbon({...inputs,canvas:track.amplitude,visualizerType:'time-ribbon',amplitudeEnvelope:track.envelope,amplitudeMaximum:.07});
    }
    timings.push(performance.now()-begin);
    document.querySelector('#position')!.textContent=`${time.toFixed(2)} s · ${playing?'playing':'paused'} · pitch ${pitch} st`;
    if(timings.length===120){const sorted=[...timings].sort((a,b)=>a-b);document.querySelector('#timing')!.textContent=`3 paired panels: mean ${(timings.reduce((a,b)=>a+b,0)/timings.length).toFixed(2)} ms · p95 ${sorted[113].toFixed(2)} ms`;timings.length=0;}
    requestAnimationFrame(frame);
  }
  window.addEventListener('pagehide',()=>{client.dispose();void context.close();},{once:true});
  frame();
});

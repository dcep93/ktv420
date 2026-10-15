import './src/styles/theme.css';
import './src/index.css';
import { resizeVisualizer } from './src/features/stems/player/visuals/canvas';
import { drawStemWeather } from './src/features/stems/player/visuals/stemWeather';
import { drawSpectrogram } from './src/features/stems/player/visuals/spectrogram';
import { drawStereoBloom } from './src/features/stems/player/visuals/stereoBloom';
import { createStereoTap } from './src/features/stems/player/visuals/analysis';
const weather=document.querySelector<HTMLCanvasElement>('#weather')!,spectrogram=document.querySelector<HTMLCanvasElement>('#spectrogram')!,bloom=document.querySelector<HTMLCanvasElement>('#bloom')!;
const canvases=[weather,spectrogram,bloom];const observer=new ResizeObserver(()=>canvases.forEach(resizeVisualizer));canvases.forEach(c=>observer.observe(c));
let started=false,muted=false;
document.querySelector('#mute')!.addEventListener('click',event=>{muted=!muted;(event.target as HTMLButtonElement).textContent=muted?'Unmute drums':'Mute drums';});
document.querySelector('#start')!.addEventListener('click',async()=>{
 if(started)return;started=true;const context=new AudioContext(),silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);
 const voices=['drums','bass','vocals','other'].map((name,index)=>{
  const buffer=context.createBuffer(2,context.sampleRate*8,context.sampleRate);
  for(let channel=0;channel<2;channel++)for(let i=0;i<buffer.length;i++){
   const t=i/context.sampleRate,beat=t%.5,noise=Math.sin(i*127.1)*43758.5453%1;
   buffer.getChannelData(channel)[i]=name==='drums' ? .55*Math.exp(-beat*30)*(Math.sin(t*2*Math.PI*90)+noise*.5) : name==='bass' ? .23*Math.sin(2*Math.PI*82*t)*(0.65+.35*Math.sin(t*Math.PI)) : name==='vocals' ? .16*(Math.sin(2*Math.PI*330*t+Math.sin(t*3)*2)+.3*Math.sin(t*2*Math.PI*660))*(.65+.35*Math.sin(t*2)) : .12*(Math.sin(t*2*Math.PI*(220+channel*2))+Math.sin(t*2*Math.PI*(330-channel*2)));
  }
  const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
  const analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);analyser.connect(silent);source.start();
  return {name:name+'.wav',input:false,analyser,audible:true,index};
 });
 const tap=createStereoTap(voices[3].analyser);await context.resume();
 const render=()=>{voices[0].audible=!muted;drawStemWeather(weather,voices,context.currentTime,true);drawSpectrogram(spectrogram,voices[2].analyser,context.currentTime,true);drawStereoBloom(bloom,tap);requestAnimationFrame(render);};render();
 document.querySelector('#result')!.textContent='Synthetic stems rendered through the same visualizers as the player.';
});

import './src/styles/theme.css';
import './src/index.css';
import {drawTimeRibbon} from './src/features/stems/player/visuals/timeRibbon';
import {resizeVisualizer} from './src/features/stems/player/visuals/canvas';
const canvases=[...document.querySelectorAll('canvas')];
const observer=new ResizeObserver(()=>canvases.forEach(resizeVisualizer));
canvases.forEach(c=>observer.observe(c));
const envelope=Array.from({length:6000},(_,i)=>.15+.18*(1+Math.sin(i*.037))+(i%11===0?.4:0));
let frame=0,time=10,playing=true,last=performance.now();
const analyser={frequencyBinCount:1024,getByteFrequencyData(data:Uint8Array){
  data.fill(0);data[4]=frame%2?255:254;data[92]=frame%2?254:255;
}} as unknown as AnalyserNode;
document.querySelector('#pause')!.addEventListener('click',event=>{
  playing=!playing;(event.target as HTMLButtonElement).textContent=playing?'Pause':'Resume';
});
document.querySelector('#seek')!.addEventListener('click',()=>{time+=15;});
function draw(now:number){
  if(playing)time+=Math.min(.1,(now-last)/1000);
  last=now;frame++;
  for(const canvas of canvases)drawTimeRibbon({canvas,analyser,visualizerType:'time-ribbon',currentTime:time,duration:300,isPlaying:playing,
    amplitudeEnvelope:envelope,amplitudeMaximum:.91,sampleRate:44100});
  document.querySelector('#status')!.textContent=`${playing?'Playing':'Paused'} · ${time.toFixed(2)} seconds`;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// Dev-only: real player with no delivered animation frames, no real library and silent audio.
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Player from './src/features/stems/player/Player';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerControl, MixerSnapshot } from './src/features/local/recording';
import './src/styles/theme.css';
import './src/index.css';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
window.requestAnimationFrame = () => 0;
window.cancelAnimationFrame = () => {};
const samples = new Float32Array(44100 * 2);
const blob = new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});
const names = ['input','drums','bass','other','vocals'];
const records = [0,1,2].map(index=>({md5:`background-check-${index}`,files:names.map(name=>({name:`${name}.mp3`,path:`background-check-${index}/${name==='input'?'input':'output'}/${name}.mp3`,blob}))}));
const stretched = new URLSearchParams(location.search).has('stretch');
const settings: MixerSnapshot = {tempo:stretched?.5:1,pitch:stretched?3:0,visualizer:'time-ribbon',spotlight:null,stems:names.map(name=>({name:`${name}.mp3`,input:name==='input',volume:1,mute:name==='input',deafen:false,effect:'wah',value:.5}))};
export function Preview() {
  const [index,setIndex] = useState(0),[playing,setPlaying] = useState(false),[ready,setReady] = useState(false);
  const onControls = useCallback((controls:MixerControl|null)=>{setPlaying(controls?.playing?.() ?? false);setReady(controls?.ready ?? false);},[]);
  return <main style={{padding:24}}><h1>Background playback regression</h1>
    <p>Animation frames disabled. Silent fixture. {stretched?'Tempo 0.5×, pitch +3.':'Tempo 1×, pitch 0.'}</p>
    <output>Track {index+1} of 3 · {playing?'Playing':ready?'Paused':'Loading'}{index===2&&ready&&!playing?' · Final track reached':''}</output>
    <Player key={index} record={records[index]} title={`Fixture track ${index+1}`} masterVolume={0} tempoSupported
      initialSettings={settings} onControls={onControls} autoPlayOnReady={index>0} hasNextTrack={index<2}
      onTrackEnd={()=>setIndex(value=>value+1)} combinedVisualizerExpanded={false} onCombinedVisualizerExpandedChange={()=>{}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);

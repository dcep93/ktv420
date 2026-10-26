// Development-only fixture: real player controls, silent synthetic audio, no Spotify/storage.
import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import Player from './src/features/stems/player/Player';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerControl, MixerSnapshot } from './src/features/local/recording';
import type { RecordingEvent } from './src/features/stems/player/types';
const samples = new Float32Array(44100);
const blob = new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});
const names = ['original','drums','bass','vocals','other'];
const record = {md5:'volume-check',files:names.map(name=>({name:`${name}.mp3`,path:`volume-check/${name==='original'?'input':'output'}/${name}.mp3`,blob}))};
const settings:MixerSnapshot = {visualizer:'stem-weather',spotlight:null,stems:names.map(name=>({name:`${name}.mp3`,input:name==='original',volume:1,mute:name==='original',deafen:false,effect:'wah',value:.5}))};
export function Preview() {
  const control=useRef<MixerControl|null>(null), saved=useRef<MixerSnapshot|null>(null);
  const [snapshot,setSnapshot]=useState<MixerSnapshot|null>(null),[events,setEvents]=useState(0);
  const onControls=useCallback((value:MixerControl|null)=>{control.current=value;},[]);
  const onSettings=useCallback((value:MixerSnapshot)=>setSnapshot(value),[]);
  const onEvent=useCallback((event:RecordingEvent)=>{if(event.type==='mixer_snapshot')setEvents(n=>n+1);},[]);
  return <main style={{maxWidth:1200,margin:'auto',padding:24}}>
    <h1>Volume control check</h1>
    <button onClick={()=>{saved.current=control.current?.snapshot()??null;}}>Save snapshot</button>
    <button onClick={()=>{if(saved.current)control.current?.apply(saved.current);}}>Replay snapshot</button>
    <button onClick={()=>control.current?.apply(settings)}>Reset fixture</button>
    <output id="volume-state" style={{display:'block'}}>Snapshots: {events} · {JSON.stringify(snapshot?.stems.map(stem=>({name:stem.name,volume:stem.volume,mute:stem.mute,locked:stem.locked})))}</output>
    <Player record={record} title="Silent volume fixture" initialSettings={settings} masterVolume={0} isRecording
      onControls={onControls} onSettingsChange={onSettings} onRecordingEvent={onEvent}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);

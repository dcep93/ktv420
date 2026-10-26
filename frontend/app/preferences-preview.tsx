// Dev-only: production persistence/player, fixture-only storage, silent audio.
import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import Player from './src/features/stems/player/Player';
import { usePlayerPreferences } from './src/features/local/usePlayerPreferences';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerControl, MixerSnapshot } from './src/features/local/recording';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const key='ktv420.player-preferences.test-fixture';
const samples=new Float32Array(44100),blob=new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});
const names=['original','drums','bass','vocals','other'];
const record={md5:'preferences-check',files:names.map(name=>({name:`${name}.mp3`,path:`preferences-check/${name==='original'?'input':'output'}/${name}.mp3`,blob}))};
const sampleSettings:MixerSnapshot={tempo:1.2,pitch:-3,visualizer:'pitch-ribbon',spotlight:null,stems:names.map((name,i)=>({name:`${name}.mp3`,input:name==='original',volume:i===2?.43:1,mute:name==='original'||name==='drums',deafen:false,locked:name==='bass',effect:'underwater',value:.72,effectSettings:{bypass:false,bpm:128,beats:1}}))};
export function Preview(){
  const [replaying,setReplaying]=useState(false),prefs=usePlayerPreferences(!replaying,key);
  const controls=useRef<MixerControl|null>(null),[snapshot,setSnapshot]=useState<MixerSnapshot|null>(null),[playing,setPlaying]=useState(false);
  const onControls=useCallback((value:MixerControl|null)=>{controls.current=value;if(value?.ready){setSnapshot(value.snapshot());setPlaying(value.playing?.()??false);}},[]);
  return <main style={{maxWidth:1200,margin:'auto',padding:24}}>
    <h1>Player preferences · reload check</h1>
    <p>Silent player. Dedicated test storage; no Spotify or audio library changes.</p>
    <button onClick={()=>controls.current?.apply(sampleSettings)}>Set test mix</button>
    <label><input type="checkbox" checked={replaying} onChange={event=>setReplaying(event.target.checked)}/>Replay mode</label>
    <button onClick={()=>controls.current?.apply({...sampleSettings,tempo:.8,pitch:5,visualizer:'highway',stems:sampleSettings.stems.map(stem=>({...stem,volume:1.8,effect:'chorus',value:1}))})}>Apply replay mix</button>
    <label><input type="checkbox" checked={prefs.combinedVisualizerExpanded} onChange={event=>prefs.setCombinedVisualizerExpanded(event.target.checked)}/>Expanded scene</label>
    <button onClick={()=>location.reload()}>Reload now</button>
    <output id="preferences-state" style={{display:'block',fontSize:12,marginTop:12}}>{JSON.stringify({expanded:prefs.combinedVisualizerExpanded,playing,snapshot})}</output>
    <Player key={replaying?'replay':'manual'} record={record} title="Preferences fixture" masterVolume={0} tempoSupported replaying={replaying}
      initialSettings={replaying?undefined:prefs.mixerSettings.current} onSettingsChange={prefs.rememberMixerSettings} onControls={onControls}
      combinedVisualizerExpanded={prefs.combinedVisualizerExpanded} onCombinedVisualizerExpandedChange={prefs.setCombinedVisualizerExpanded}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);

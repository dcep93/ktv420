import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_PREFERENCES_KEY, PlayerPreferences } from './playerPreferences';
import type { MixerSnapshot } from './recording';
const mixer: MixerSnapshot = {tempo:1.2,pitch:-3,visualizer:'pitch-ribbon',spotlight:{intent:{kind:'output',name:'vocals.mp3'},level:'track'},
  stems:[{name:'vocals.mp3',input:false,volume:.43,mute:true,deafen:false,locked:true,effect:'underwater',value:.82,effectSettings:{bypass:false,bpm:128,beats:1}}]};
function fixture(initial?: string) {
  const values = new Map<string,string>(initial ? [[PLAYER_PREFERENCES_KEY,initial]] : []);
  const timers = new Set<() => void>(); let writes=0;
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);writes++;}};
  const schedule=(callback:()=>void,delay:number)=>{assert.equal(delay,150);timers.add(callback);return ()=>{timers.delete(callback);};};
  return {values,timers,storage,schedule,writes:()=>writes,run:()=>{for(const callback of [...timers])callback();},create:()=>new PlayerPreferences(()=>storage,{schedule})};
}
test('all mixer and expanded preferences restore synchronously without an initial write',()=>{
  const f=fixture(),store=f.create();store.setMixer(mixer);store.setExpanded(true);store.flush();
  const restored=f.create();assert.deepEqual(restored.current,{version:1,mixer,expanded:true});
  restored.flush();assert.equal(f.writes(),1);assert.equal(f.timers.size,0);
});
test('rapid changes update memory immediately but persist only the newest snapshot',()=>{
  const f=fixture(),store=f.create();
  for(let i=0;i<20;i++)store.setMixer({...mixer,pitch:i%10});
  assert.equal(store.current.mixer!.pitch,9);assert.equal(f.writes(),0);assert.equal(f.timers.size,1);
  f.run();assert.equal(f.writes(),1);assert.equal(f.create().current.mixer!.pitch,9);
  store.setMixer({...mixer,pitch:9});f.run();assert.equal(f.writes(),1,'unchanged snapshots do not write');
});
test('leaving flushes pending changes and cancels the delayed write',()=>{
  const f=fixture(),store=f.create();store.setMixer(mixer);store.flush();f.run();
  assert.equal(f.writes(),1);assert.equal(f.timers.size,0);assert.deepEqual(f.create().current.mixer,mixer);
});
test('stored snapshot is detached from caller mutations',()=>{
  const f=fixture(),store=f.create(),input=structuredClone(mixer);store.setMixer(input);
  input.stems[0].volume=0;input.spotlight=null;
  store.flush();assert.deepEqual(f.create().current.mixer,mixer);
});
test('bad versions, malformed data and unsupported mixer choices use safe defaults',()=>{
  for(const text of ['{','null','{}',JSON.stringify({version:2,mixer,expanded:true}),
    JSON.stringify({version:1,mixer:{...mixer,tempo:99},expanded:true}),
    JSON.stringify({version:1,mixer:{...mixer,visualizer:'missing'},expanded:true}),
    JSON.stringify({version:1,mixer:{...mixer,stems:[{...mixer.stems[0],effect:'missing'}]},expanded:true}),
    ' '.repeat(65537)]){
    const f=fixture(text),store=f.create();assert.deepEqual(store.current,{version:1,mixer:null,expanded:false});store.flush();assert.equal(f.writes(),0);
  }
});
test('blocked reads and failed writes never prevent in-memory mixer changes',()=>{
  const f=fixture();let blocked=true;
  const store=new PlayerPreferences(()=>{if(blocked)throw Error('Storage denied');return f.storage;},{schedule:f.schedule});
  store.setMixer(mixer);store.setExpanded(true);assert.doesNotThrow(()=>store.flush());assert.deepEqual(store.current.mixer,mixer);
  blocked=false;store.flush();assert.equal(f.writes(),1);assert.equal(f.create().current.expanded,true);
  const full=new PlayerPreferences(()=>({getItem:()=>null,setItem:()=>{throw Error('Quota');}}),{schedule:f.schedule});
  full.setMixer(mixer);assert.doesNotThrow(()=>full.flush());assert.deepEqual(full.current.mixer,mixer);
});

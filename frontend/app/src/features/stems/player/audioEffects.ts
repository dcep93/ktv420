import processorUrl from './effects/processor.ts?worker&url';
import { defaultEffectSettings, effectIds, type AudioEffectType, type EffectSettings } from './effects/catalog';
export * from './effects/catalog';
export type EffectNodes = { node: AudioWorkletNode };
const modules=new WeakMap<BaseAudioContext,Promise<void>>();
export function prepareAudioEffects(context:BaseAudioContext){
  let ready=modules.get(context);
  if(!ready){ready=context.audioWorklet.addModule(processorUrl);modules.set(context,ready);void ready.catch(()=>modules.delete(context));}
  return ready;
}
export function createEffectNodes(context:BaseAudioContext):EffectNodes {
  return {node:new AudioWorkletNode(context,'ktv420-effects',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'})};
}
export function disposeAudioEffects(nodes:EffectNodes){nodes.node.port.postMessage('dispose');nodes.node.disconnect();nodes.node.port.close();}
function parameter(nodes:EffectNodes,name:string,value:number,time:number){
  const p=nodes.node.parameters.get(name)!;
  // Reapplying a mixer snapshot must not restart a tail or its smoothing.
  if(p.value!==value)p.setValueAtTime(value,time);
}
export function applyAudioEffect({context,nodes,effect,value,settings=defaultEffectSettings,tempo=1}:{context:BaseAudioContext;nodes:EffectNodes;effect:AudioEffectType;value:number;settings?:EffectSettings;tempo?:number}){
  const now=context.currentTime;
  parameter(nodes,'effect',Math.max(0,effectIds.indexOf(effect)),now);
  parameter(nodes,'amount',value,now);parameter(nodes,'bypass',settings.bypass?1:0,now);
  parameter(nodes,'bpm',settings.bpm,now);parameter(nodes,'beats',settings.beats,now);parameter(nodes,'tempo',tempo,now);
}
/** Same song position produces the same modulation phase during live/replay/export. */
export function syncAudioEffects(nodes:EffectNodes,position:number,rate:number,when:number){
  nodes.node.parameters.get('clockRate')!.cancelScheduledValues(when);
  nodes.node.parameters.get('clockOffset')!.cancelScheduledValues(when);
  nodes.node.parameters.get('clockRate')!.setValueAtTime(rate,when);
  nodes.node.parameters.get('clockOffset')!.setValueAtTime(position-when*rate,when);
}

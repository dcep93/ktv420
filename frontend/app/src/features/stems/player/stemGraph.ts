import { disposeAudioEffects, type EffectNodes } from './audioEffects';
/** Live mixer and offline export share gain-before-effects routing. */
export function connectStemEffects(input:GainNode,effects:EffectNodes,output:AudioNode){input.connect(effects.node);effects.node.connect(output);}
export function disposeStemEffects(input:GainNode,effects:EffectNodes){input.disconnect();disposeAudioEffects(effects);}

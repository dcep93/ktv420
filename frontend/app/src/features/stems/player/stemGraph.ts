import type { EffectNodes } from './audioEffects';
/** Live mixer and offline export must use the same gain-before-effects routing. */
export function connectStemEffects(input: GainNode, effects: EffectNodes, output: AudioNode) {
  input.connect(effects.filter); input.connect(effects.dryGain);
  effects.wetGain.connect(output); effects.dryGain.connect(output);
}
export function disposeStemEffects(input: GainNode, effects: EffectNodes) {
  input.disconnect(); effects.lfo.stop();
  for (const node of Object.values(effects)) {
    if (Array.isArray(node)) node.forEach(part => part.disconnect());
    else node.disconnect();
  }
}

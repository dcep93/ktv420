import type { PlateArtwork } from './plateArtwork';
import { drawArtScene, resetArtScene } from './artScenes';
import { drawHighway, resetHighway } from './highway';
import type { VisualizerType } from '../types';
import { drawStemWeather, resetWeather } from './stemWeather';
import { drawStemScene, resetStemScene } from './stemScenes';
import type { StemVoice } from './stemScene';

export const combinedVisualizers = {
  beach: { label: 'Beach' },
  aquarium: { label: 'Aquarium' },
  'rock-show': { label: 'Rock Show' },
  'disco-ball': { label: 'Disco Ball' },
  'signal-loom': { label: 'Signal Loom' },
  'ink-tank': { label: 'Ink Tank' },
  'resonance-plate': { label: 'Resonance Plate' },
  glassworks: { label: 'Glassworks' },
  highway: { label: 'Highway' },
  'stem-weather': { label: 'Stem Weather' },
  'night-city': { label: 'Night City' },
  'stem-garden': { label: 'Stem Garden' },
  'stem-orbit': { label: 'Orbit' },
} as const;
export type CombinedVisualizerType = keyof typeof combinedVisualizers;
export function isCombinedVisualizer(type: VisualizerType): type is CombinedVisualizerType {
  return Object.hasOwn(combinedVisualizers, type);
}
export function drawCombinedVisualizer(type: CombinedVisualizerType, canvas: HTMLCanvasElement, voices: StemVoice[], time: number, playing: boolean, artwork?: PlateArtwork) {
  if (type === 'stem-weather') drawStemWeather(canvas, voices, time, playing);
  else if (type === 'highway') drawHighway(canvas, voices, time, playing);
  else if (type === 'signal-loom' || type === 'ink-tank' || type === 'resonance-plate' || type === 'glassworks' || type === 'beach' || type === 'aquarium' || type === 'rock-show' || type === 'disco-ball') drawArtScene(type, canvas, voices, time, playing, artwork);
  else drawStemScene(type, canvas, voices, time, playing);
}
export function resetCombinedVisualizer(canvas: HTMLCanvasElement) { resetArtScene(canvas); resetWeather(canvas); resetStemScene(canvas); resetHighway(canvas); }

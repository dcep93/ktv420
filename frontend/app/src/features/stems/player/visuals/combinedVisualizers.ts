import { drawArtScene, resetArtScene } from './artScenes';
import { drawHighway, resetHighway } from './highway';
import type { VisualizerType } from '../types';
import { drawStemWeather, resetWeather } from './stemWeather';
import { drawStemScene, resetStemScene } from './stemScenes';
import type { StemVoice } from './stemScene';

export const combinedVisualizers = {
  'signal-loom': { label: 'Signal Loom', legend: ['Drums · stitches', 'Bass · warp', 'Vocals · silk', 'Other · weave'] },
  'ink-tank': { label: 'Ink Tank', legend: ['Drums · jets', 'Bass · circulation', 'Vocals · ribbons', 'Other · diffusion'] },
  'resonance-plate': { label: 'Resonance Plate', legend: ['Drums · grains', 'Bass · nodes', 'Vocals · harmonics', 'Other · interference'] },
  glassworks: { label: 'Glassworks', legend: ['Drums · seams', 'Bass · amber', 'Vocals · rose', 'Other · teal'] },
  highway: { label: 'Highway', legend: ['Drums · roadside lights', 'Bass · road glow', 'Vocals · sun', 'Other · sky'] },
  'stem-weather': { label: 'Stem Weather', legend: ['Drums · rain', 'Bass · waves', 'Vocals · thread', 'Other · atmosphere'] },
  'night-city': { label: 'Night City', legend: ['Drums · windows', 'Bass · skyline', 'Vocals · neon', 'Other · haze'] },
  'stem-garden': { label: 'Stem Garden', legend: ['Drums · seeds', 'Bass · roots', 'Vocals · vine', 'Other · leaves'] },
  'stem-orbit': { label: 'Orbit', legend: ['Drums · rings', 'Bass · star', 'Vocals · comet', 'Other · constellations'] },
} as const;
export type CombinedVisualizerType = keyof typeof combinedVisualizers;
export function isCombinedVisualizer(type: VisualizerType): type is CombinedVisualizerType {
  return Object.hasOwn(combinedVisualizers, type);
}
export function drawCombinedVisualizer(type: CombinedVisualizerType, canvas: HTMLCanvasElement, voices: StemVoice[], time: number, playing: boolean) {
  if (type === 'stem-weather') drawStemWeather(canvas, voices, time, playing);
  else if (type === 'highway') drawHighway(canvas, voices, time, playing);
  else if (type === 'signal-loom' || type === 'ink-tank' || type === 'resonance-plate' || type === 'glassworks') drawArtScene(type, canvas, voices, time, playing);
  else drawStemScene(type, canvas, voices, time, playing);
}
export function resetCombinedVisualizer(canvas: HTMLCanvasElement) { resetArtScene(canvas); resetWeather(canvas); resetStemScene(canvas); resetHighway(canvas); }

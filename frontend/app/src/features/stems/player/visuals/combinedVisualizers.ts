import { drawHighway, resetHighway } from './highway';
import type { VisualizerType } from '../types';
import { drawStemWeather, resetWeather } from './stemWeather';
import { drawStemScene, resetStemScene } from './stemScenes';
import type { StemVoice } from './stemScene';

export const combinedVisualizers = {
  highway: { label: 'Highway', legend: ['Drums · roadside lights', 'Bass · road glow', 'Vocals · sun', 'Other · desert'] },
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
  else drawStemScene(type, canvas, voices, time, playing);
}
export function resetCombinedVisualizer(canvas: HTMLCanvasElement) { resetWeather(canvas); resetStemScene(canvas); resetHighway(canvas); }

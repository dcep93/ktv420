import type { ArtState } from './artSceneState';
import type { StemRole } from './stemScene';

/** Reflect rather than wrap: continuous position through every wall collision. */
export function reflectedPosition(time: number, crossingSeconds: number, phase: number) {
  const value = ((time / crossingSeconds + phase) % 2 + 2) % 2;
  return value <= 1 ? value : 2 - value;
}
export const sceneLevel = (state: ArtState, role: StemRole) => Math.max(state.audio.levels[role], state.audio.levels.original);
export const sceneEnergy = (state: ArtState) => Math.max(...Object.values(state.audio.levels));

import { drawBeach } from './beach';
import { drawAquarium } from './aquarium';
import { drawRockShow } from './rockShow';
import { drawDiscoBall } from './discoBall';
import { beginVisualizer } from './canvas';
import type { StemVoice } from './stemScene';
import { createArtState, updateArtState, type ArtState } from './artSceneState';
import { drawLoom } from './signalLoom';
import { drawInk } from './inkTank';
import type { PlateArtwork } from './plateArtwork';
import { drawPlate } from './resonancePlate';
import { drawGlass } from './glassworks';

export type ArtScene = 'signal-loom' | 'ink-tank' | 'resonance-plate' | 'glassworks' | 'beach' | 'aquarium' | 'rock-show' | 'disco-ball';
const states = new WeakMap<HTMLCanvasElement, ArtState>();
export function resetArtScene(canvas: HTMLCanvasElement) { states.delete(canvas); }
export function drawArtScene(mode: ArtScene, canvas: HTMLCanvasElement, voices: StemVoice[], time: number, playing: boolean, artwork?: PlateArtwork) {
  const surface = beginVisualizer(canvas); if (!surface) return;
  let state = states.get(canvas); if (!state) { state = createArtState(); states.set(canvas, state); }
  updateArtState(state, voices, time, playing);
  const { context: c, width: w, height: h } = surface;
  try {
    c.fillStyle = surface.background; c.fillRect(0, 0, w, h);
    const frame = { c, w, h, state };
    if (mode === 'signal-loom') drawLoom(frame);
    else if (mode === 'ink-tank') drawInk(frame);
    else if (mode === 'resonance-plate') drawPlate(frame, artwork);
    else if (mode === 'beach') drawBeach(frame);
    else if (mode === 'aquarium') drawAquarium(frame);
    else if (mode === 'rock-show') drawRockShow(frame);
    else if (mode === 'disco-ball') drawDiscoBall(frame);
    else drawGlass(frame);
  } finally { c.restore(); }
}

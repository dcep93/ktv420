import { bandLevel } from './analysis';
import { color, createStemSceneState, seed, stemRole, stemRoles, updateStemScene, type StemVoice } from './stemScene';

export const HISTORY = 96;
export function createArtState() {
  return { audio: createStemSceneState(), time: 0, lastTime: -1, sample: -1, head: 0, count: 0,
    history: stemRoles.map(() => new Float32Array(HISTORY)),
    heldLevels: new Float32Array(5), heldPulse: 0, bands: new Float32Array(5), enabled: new Uint8Array(5) };
}
export type ArtState = ReturnType<typeof createArtState>;
export function updateArtState(state: ArtState, voices: StemVoice[], time: number, playing: boolean) {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  const reset = state.lastTime < 0 || time < state.lastTime || time - state.lastTime > .5;
  const dt = reset ? 0 : Math.max(0, time - state.lastTime);
  if (reset) {
    state.history.forEach(buffer => buffer.fill(0)); state.count = state.head = 0; state.sample = -1;
    state.bands.fill(0);
  }
  // Geometry only advances with the transport, never with wall time.
  if (playing || reset) state.time = time;
  state.lastTime = time;
  if (playing || reset) {
    updateStemScene(state.audio, voices, time, playing);
    stemRoles.forEach((role, i) => { state.heldLevels[i] = state.audio.levels[role]; });
    state.heldPulse = state.audio.pulse;
  }
  state.enabled.fill(0);
  for (let i = 0; i < stemRoles.length; i++) {
    const role = stemRoles[i];
    let band = 0;
    for (const voice of voices) if (voice.audible && stemRole(voice.name, voice.input) === role) {
      state.enabled[i] = 1;
      band = Math.max(band, bandLevel(voice.analyser, role === 'bass' ? 40 : 300, role === 'bass' ? 250 : 4000));
    }
    if (!playing && !reset) state.audio.levels[role] = state.enabled[i] ? state.heldLevels[i] : 0;
    if (!state.enabled[i]) { state.history[i].fill(0); state.bands[i] = 0; }
    else if (reset) state.bands[i] = band;
    else if (playing) state.bands[i] += (band - state.bands[i]) * (1 - Math.exp(-dt * 2));
  }
  if (!playing && !reset) state.audio.pulse = state.enabled[0] ? state.heldPulse : 0;
  const sample = Math.floor(time * 12);
  if ((playing || reset) && sample !== state.sample) {
    state.head = (state.head + 1) % HISTORY; state.count = Math.min(HISTORY, state.count + 1); state.sample = sample;
    for (let i = 0; i < stemRoles.length; i++) state.history[i][state.head] = state.audio.levels[stemRoles[i]];
  }
  return state;
}
export type ArtFrame = { c: CanvasRenderingContext2D; w: number; h: number; state: ArtState };
export { color, seed, stemRoles };

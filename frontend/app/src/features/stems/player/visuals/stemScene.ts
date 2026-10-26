import { bandLevel, signalRms, waveform } from './analysis';

export const stemRoles = ['drums', 'bass', 'vocals', 'other', 'original'] as const;
export type StemRole = typeof stemRoles[number];
export type StemVoice = { name: string; input: boolean; analyser: AnalyserNode; audible: boolean };
export function stemRole(name: string, input: boolean): StemRole {
  if (input) return 'original';
  const stem = name.replace(/\.(mp3|wav)$/i, '').toLowerCase();
  return stem === 'drums' || stem === 'bass' || stem === 'vocals' ? stem : 'other';
}

const emptyLevels = (): Record<StemRole, number> => ({ drums: 0, bass: 0, vocals: 0, other: 0, original: 0 });
export function createStemSceneState() {
  return { levels: emptyLevels(), targets: emptyLevels(), lastTime: -1, pulse: 0,
    strikeTime: -Infinity, vocalWave: undefined as Float32Array | undefined };
}
export type StemSceneState = ReturnType<typeof createStemSceneState>;

// Fixed scaling preserves fader changes. No per-frame buffers or extra audio nodes.
export function updateStemScene(state: StemSceneState, voices: readonly StemVoice[], time: number, playing: boolean) {
  const reset = state.lastTime < 0 || time < state.lastTime || time - state.lastTime > .5;
  const dt = reset ? 0 : Math.max(0, Math.min(.1, time - state.lastTime));
  if (reset) { for (const role of stemRoles) state.levels[role] = 0; state.pulse = 0; state.strikeTime = -Infinity; }
  state.lastTime = time;
  state.vocalWave = undefined;
  for (const role of stemRoles) state.targets[role] = 0;
  for (const voice of voices) {
    if (!voice.audible) continue;
    const role = stemRole(voice.name, voice.input), samples = waveform(voice.analyser);
    let energy = signalRms(samples) * 3.5;
    if (role === 'bass') energy *= .45 + bandLevel(voice.analyser, 30, 250);
    state.targets[role] = Math.min(1, state.targets[role] + energy);
    if (role === 'vocals') state.vocalWave = samples;
  }
  const onset = Math.max(0, state.targets.drums - state.levels.drums);
  if (playing && onset > .06 && time - state.strikeTime > .12) state.strikeTime = time;
  state.pulse = playing && state.targets.drums > .001 ? Math.max(onset * 2, state.pulse * Math.exp(-dt * 12)) : 0;
  for (const role of stemRoles) {
    // Explicit mute/solo clears the layer immediately, not just its new emissions.
    const enabled = voices.some(voice => voice.audible && stemRole(voice.name, voice.input) === role);
    state.levels[role] = enabled ? state.levels[role] + (state.targets[role] - state.levels[role]) *
      (reset ? 1 : playing ? 1 - Math.exp(-Math.max(.016, dt) * 9) : .25) : 0;
  }
  if (!voices.some(voice => voice.audible && stemRole(voice.name, voice.input) === 'drums')) state.strikeTime = -Infinity;
  return state;
}

export const sceneColors = { drums: '230,181,115', bass: '190,144,93', vocals: '255,123,195', other: '130,192,190', original: '226,190,141' };
// A gentle opacity curve keeps quiet detail readable on the dark canvas while
// preserving zero for silence and visibly following the fader.
export const color = (role: StemRole, alpha: number) => `rgba(${sceneColors[role]},${Math.pow(Math.max(0, Math.min(1, alpha)), .65)})`;
export const seed = (index: number) => { const value = Math.sin(index * 127.1 + 91.7) * 43758.5453; return value - Math.floor(value); };

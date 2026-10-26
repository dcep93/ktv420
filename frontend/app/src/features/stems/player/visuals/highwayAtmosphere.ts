const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };

export function createHighwayAtmosphere() {
  return { daylight: .25, density: 0, activity: 0, envelope: 0, lastTime: -1, lastAttack: -Infinity, attackHigh: false };
}
export type HighwayAtmosphere = ReturnType<typeof createHighwayAtmosphere>;

/** Intensity sets daylight; attack frequency sets clouds/stars. Neither follows individual beats. */
export function updateHighwayAtmosphere(state: HighwayAtmosphere, intensity: number, time: number, playing: boolean) {
  if (!Number.isFinite(time)) return state;
  const energy = clamp(intensity), elapsed = time - state.lastTime;
  if (state.lastTime < 0 || elapsed < 0 || elapsed > .5) {
    state.lastTime = time; state.envelope = energy; state.lastAttack = -Infinity; state.attackHigh = false;
    return state; // Seeking is not an attack and must not jump the sky.
  }
  state.lastTime = time;
  if (!playing || elapsed <= 0) return state;
  const dt = elapsed;
  const targetDay = smoothstep((energy - .08) / .67);
  const dayStep = (targetDay - state.daylight) * (1 - Math.exp(-dt / 18));
  state.daylight = clamp(state.daylight + Math.max(-dt / 35, Math.min(dt / 35, dayStep)));
  state.activity *= Math.exp(-dt / 4);
  const attack = energy - state.envelope;
  if (attack < .025) state.attackHigh = false;
  if (attack > .055 && !state.attackHigh && time - state.lastAttack > .18) {
    state.attackHigh = true;
    state.activity = Math.min(1.5, state.activity + .16);
    state.lastAttack = time;
  }
  state.envelope += (energy - state.envelope) * (1 - Math.exp(-dt * 12));
  state.density += (clamp(state.activity) - state.density) * (1 - Math.exp(-dt / 3));
  return state;
}

/** Open desert and cactus-rich stretches repeat gently, independent of the mix. */
export function highwayDesert(time: number) {
  const t = Number.isFinite(time) ? time : 0;
  return .18 + .82 * (.5 - .5 * Math.cos(t * Math.PI * 2 / 60));
}

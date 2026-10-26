const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function createKaleidoscopeMotion() {
  return { lastTime: -1, energy: 0, bass: 0, pulse: 0, baseline: 0, phase: 0, rotation: 0 };
}
export type KaleidoscopeMotion = ReturnType<typeof createKaleidoscopeMotion>;

export function updateKaleidoscopeMotion(state: KaleidoscopeMotion, time: number, playing: boolean,
  audible: boolean, energy: number, bass: number) {
  if (!Number.isFinite(time)) return state;
  const elapsed = time - state.lastTime;
  state.lastTime = time;
  if (!playing || !audible) return state;
  energy = clamp(energy); bass = clamp(bass);
  // A seek is not an onset and must not integrate minutes of movement in one frame.
  if (elapsed < 0 || elapsed > .5 || elapsed === 0) {
    state.baseline = energy;
    return state;
  }
  const dt = Math.min(.1, elapsed);
  state.energy += (energy - state.energy) * (1 - Math.exp(-dt / .35));
  state.bass += (bass - state.bass) * (1 - Math.exp(-dt / .45));
  const attack = clamp((energy - state.baseline - .025) * 3.5);
  state.baseline += (energy - state.baseline) * (1 - Math.exp(-dt / .22));
  state.pulse += (attack - state.pulse) * (1 - Math.exp(-dt / (attack > state.pulse ? .08 : .32)));
  // Roughly 14–50 seconds per pattern orbit for normal music; silence settles.
  const activity = Math.min(1, state.energy * 3);
  state.phase += dt * activity * (.13 + state.energy * .3 + state.bass * .08);
  state.rotation += dt * activity * (.035 + state.energy * .07 + state.bass * .025);
  return state;
}

export function kaleidoscopePose(state: KaleidoscopeMotion) {
  return { x: -230 + Math.sin(state.phase) * 150 + Math.sin(state.phase * .43) * 45,
    y: 130 + Math.cos(state.phase * .79) * 145,
    rotation: state.rotation + Math.sin(state.phase * .5) * .045,
    scale: .8 * (1 + state.energy * .045 + state.pulse * .075) };
}

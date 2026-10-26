const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function createKaleidoscopeMotion() {
  return { lastTime: -1, energy: 0, bass: 0, phase: 0, rotation: 0,
    orbitSpeed: 0, rotationSpeed: 0, scale: .8 };
}
export type KaleidoscopeMotion = ReturnType<typeof createKaleidoscopeMotion>;

export function updateKaleidoscopeMotion(state: KaleidoscopeMotion, time: number, playing: boolean,
  audible: boolean, energy: number, bass: number) {
  if (!Number.isFinite(time)) return state;
  const elapsed = time - state.lastTime;
  state.lastTime = time;
  if (!playing || !audible) return state;
  energy = clamp(energy); bass = clamp(bass);
  // Preserve the lens pose and momentum across seeks without integrating the jump.
  if (elapsed < 0 || elapsed > .5 || elapsed === 0) return state;
  const dt = Math.min(.1, elapsed);
  state.energy += (energy - state.energy) * (1 - Math.exp(-dt / 1.8));
  state.bass += (bass - state.bass) * (1 - Math.exp(-dt / 2.4));
  // Heavy optics: music changes the desired speed, never the position directly.
  // A second, slower response gives the motion several seconds of momentum.
  const activity = Math.min(1, state.energy * 3);
  const previousOrbitSpeed = state.orbitSpeed, previousRotationSpeed = state.rotationSpeed;
  const momentum = 1 - Math.exp(-dt / 3.5);
  state.orbitSpeed += (activity * (.13 + state.energy * .3 + state.bass * .08) - state.orbitSpeed) * momentum;
  state.rotationSpeed += (activity * (.035 + state.energy * .07 + state.bass * .025) - state.rotationSpeed) * momentum;
  state.phase += dt * (previousOrbitSpeed + state.orbitSpeed) / 2;
  state.rotation += dt * (previousRotationSpeed + state.rotationSpeed) / 2;
  // Slow breathing replaces the onset-triggered zoom that made every beat twitch.
  state.scale += (.8 * (1 + state.energy * .045 + state.bass * .02) - state.scale) * (1 - Math.exp(-dt / 2.4));
  return state;
}

export function kaleidoscopePose(state: KaleidoscopeMotion) {
  return { x: -230 + Math.sin(state.phase) * 150 + Math.sin(state.phase * .43) * 45,
    y: 130 + Math.cos(state.phase * .79) * 145,
    rotation: state.rotation + Math.sin(state.phase * .5) * .045,
    scale: state.scale };
}

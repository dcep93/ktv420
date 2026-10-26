import { color, stemRoles, HISTORY, type ArtFrame } from './artSceneState';

export function drawLoom({ c, w, h, state }: ArtFrame) {
  const t = state.time;
  c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let role = 0; role < stemRoles.length; role++) {
    const name = stemRoles[role], level = state.audio.levels[name]; if (level < .001) continue;
    // Parallel strands share a calm carrier; recorded envelopes ripple through the weave.
    for (let strand = 0; strand < 7; strand++) {
      c.beginPath();
      for (let p = 0; p <= 80; p++) {
        const x = p / 80, age = Math.max(0, Math.min(state.count - 1, (1 - x) * 72 - (t * 12 - state.sample)));
        const newer = Math.floor(age), older = Math.min(state.count - 1, newer + 1), fraction = age - newer;
        const a = state.history[role][(state.head - newer + HISTORY) % HISTORY];
        const b = state.history[role][(state.head - older + HISTORY) % HISTORY];
        const memory = a + (b - a) * fraction;
        const carrier = Math.sin(x * Math.PI * 2 + t * .16 + role * 1.15);
        const weave = Math.sin(x * Math.PI * 6 - t * .35 + role * 1.9);
        const y = h * (.5 + carrier * .22 + weave * (.025 + memory * .07)) + (strand - 3) * h * .009;
        if (p === 0) c.moveTo(x * w, y); else c.lineTo(x * w, y);
      }
      c.strokeStyle = color(name, level * (strand === 3 ? 1.3 : .22));
      c.lineWidth = strand === 3 ? 2.2 : 1; c.stroke();
    }
  }
  if (state.audio.levels.drums > .001) {
    c.strokeStyle = color('drums', state.audio.levels.drums * .65); c.lineWidth = 1;
    for (let i = 0; i < state.count; i++) {
      if ((state.sample - i) % 3 !== 0) continue;
      const energy = state.history[0][(state.head - i + 96) % 96]; if (energy < .05) continue;
      const x = (1 - (i + (t * 12 - state.sample)) / HISTORY) * w, y = h * (.5 + .22 * Math.sin(x / w * Math.PI * 2 + t * .16));
      c.beginPath(); c.moveTo(x - 3, y - energy * h * .13); c.lineTo(x + 3, y + energy * h * .13); c.stroke();
    }
  }
}

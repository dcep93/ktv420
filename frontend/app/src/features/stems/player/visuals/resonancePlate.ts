import { color, seed, stemRoles, type ArtFrame } from './artSceneState';

// Cache two standing-wave fields per role. Only their interpolation changes per frame.
// Stable grain locations avoid random sparkle and expensive per-frame trigonometry.
const fields = stemRoles.map((_, role) => {
  const points = new Float32Array(2000 * 4), m = 2 + role, n = 3 + role;
  for (let i = 0; i < 2000; i++) {
    const x = seed(i * 2 + role * 4003), y = seed(i * 2 + 1 + role * 4003);
    points[i * 4] = x; points[i * 4 + 1] = y;
    points[i * 4 + 2] = Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y) - Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y);
    points[i * 4 + 3] = Math.cos((m + 2) * Math.PI * x) * Math.cos(n * Math.PI * y) - Math.cos(n * Math.PI * x) * Math.cos((m + 2) * Math.PI * y);
  }
  return points;
});
export function drawPlate({ c, w, h, state }: ArtFrame) {
  const height = h * .87, width = Math.min(w * .85, height * 1.5), left = (w - width) / 2, top = (h - height) / 2;
  for (let role = 0; role < stemRoles.length; role++) {
    const name = stemRoles[role], level = state.audio.levels[name]; if (level < .001) continue;
    const blend = Math.min(1, state.bands[role] * .55 + .25 + .2 * Math.sin(state.time * .045 + role));
    const points = fields[role];
    c.fillStyle = color(name, level); c.beginPath();
    for (let i = 0; i < points.length; i += 4) {
      const node = Math.abs(points[i + 2] * (1 - blend) + points[i + 3] * blend);
      // Grains shrink continuously toward the edge of a node instead of blinking off.
      const weight = Math.max(0, 1 - node / .22); if (weight <= 0) continue;
      const grain = (1.4 + level * 1.8) * Math.sqrt(weight) * Math.max(1, height / 600);
      const jitter = name === 'drums' ? state.audio.pulse * height * .006 : 0;
      c.rect(left + points[i] * width + (points[i + 1] - .5) * jitter,
        top + points[i + 1] * height + (points[i] - .5) * jitter, grain, grain);
    }
    c.fill();
  }
}

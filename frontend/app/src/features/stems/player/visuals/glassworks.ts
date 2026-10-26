import { color, seed, stemRoles, type ArtFrame } from './artSceneState';

const COLS = 14, ROWS = 8;
// Fixed tessellation: shared vertices stay joined while the lighting slowly evolves.
const vertices = Array.from({ length: (COLS + 1) * (ROWS + 1) }, (_, i) => {
  const col = i % (COLS + 1), row = Math.floor(i / (COLS + 1));
  return [(col + (col > 0 && col < COLS ? (seed(i) - .5) * .7 : 0)) / COLS,
    (row + (row > 0 && row < ROWS ? (seed(i + 503) - .5) * .7 : 0)) / ROWS];
});
export function drawGlass({ c, w, h, state }: ArtFrame) {
  const t = state.time;
  c.lineJoin = 'round'; c.lineWidth = 1.5;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const index = row * COLS + col, corner = row * (COLS + 1) + col;
    for (let half = 0; half < 2; half++) {
      const id = index * 2 + half, role = Math.floor(seed(id + 701) * 4);
      const name = stemRoles[role], own = state.audio.levels[name], original = state.audio.levels.original;
      const level = Math.max(own, original); if (level < .001) continue;
      const tone = own >= original ? name : 'original';
      const illumination = .4 + .3 * (.5 + .5 * Math.sin(col * .45 + row * .6 - t * .13));
      const a = vertices[corner], b = vertices[corner + (half ? COLS + 1 : 1)], d = vertices[corner + COLS + 2];
      c.beginPath(); c.moveTo(a[0] * w, a[1] * h); c.lineTo(b[0] * w, b[1] * h); c.lineTo(d[0] * w, d[1] * h); c.closePath();
      c.fillStyle = color(tone, level * illumination); c.fill();
      c.strokeStyle = color(tone, level * (.2 + (name === 'drums' ? state.audio.pulse * .45 : 0))); c.stroke();
      // A restrained bevel catches light along one edge, leaving dark lead seams.
      c.beginPath(); c.moveTo(a[0] * w + 2, a[1] * h + 2); c.lineTo(b[0] * w - 2, b[1] * h + 2);
      c.strokeStyle = color(tone, level * .18); c.stroke();
    }
  }
}

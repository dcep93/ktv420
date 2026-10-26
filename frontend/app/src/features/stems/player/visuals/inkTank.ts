import { reflectedPosition } from './sceneMotion';
import { color, seed, stemRoles, type ArtFrame } from './artSceneState';

// Bounded analytic advection: no growing particle list or full-resolution fluid buffers.
export function drawInk({ c, w, h, state }: ArtFrame) {
  const t = state.time * .12, size = Math.min(w, h);
  c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let role = 0; role < stemRoles.length; role++) {
    const name = stemRoles[role], level = state.audio.levels[name]; if (level < .001) continue;
    // Leave room for the outer filaments; traverse the entire usable tank.
    const radiusScale = size * .53;
    const marginX = radiusScale * .8, marginY = radiusScale * .43;
    const cx = marginX + (w - marginX * 2) * reflectedPosition(state.time, 28 + role * 4, seed(role + 811) * 2);
    const cy = marginY + (h - marginY * 2) * reflectedPosition(state.time, 21 + role * 5, seed(role + 931) * 2);
    const haze = c.createRadialGradient(cx, cy, 0, cx, cy, size * .48);
    haze.addColorStop(0, color(name, level * .06)); haze.addColorStop(.5, color(name, level * .025)); haze.addColorStop(1, color(name, 0));
    c.fillStyle = haze; c.fillRect(cx - size * .5, cy - size * .5, size, size);
    for (let thread = 0; thread < 18; thread++) {
      const phase = seed(thread + role * 101) * Math.PI * 2;
      c.beginPath(); let previousX = 0, previousY = 0;
      for (let p = 0; p <= 48; p++) {
        const u = p / 48, a = phase + u * 3.8 + t * (role === 1 ? -.55 : .7);
        const radius = radiusScale * (.06 + u * .36) * (.7 + level * .45);
        const fold = Math.sin(u * 9 + phase + t) * radiusScale * .045;
        const x = cx + Math.cos(a) * radius * (1.25 + .3 * Math.sin(t * .7)) + Math.sin(a * 2 + t) * fold;
        const y = cy + Math.sin(a) * radius * .72 + Math.cos(a * 3 - t) * fold;
        if (p === 0) c.moveTo(x, y);
        else c.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
        previousX = x; previousY = y;
      }
      c.strokeStyle = color(name, level * (thread % 5 === 0 ? .4 : .075));
      c.lineWidth = thread % 5 === 0 ? 1 : size * .022; c.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const a = seed(i + role * 37) * Math.PI * 2 + t * .4;
      const radius = radiusScale * (.1 + seed(i + 409) * .4);
      c.fillStyle = color(name, level * .3); c.beginPath();
      c.arc(cx + Math.cos(a) * radius * 1.3, cy + Math.sin(a) * radius * .8, .6 + seed(i) * 1.2, 0, Math.PI * 2); c.fill();
    }
  }
  const pulse = state.audio.pulse;
  if (pulse > .01) {
    c.strokeStyle = color('drums', pulse * .3); c.lineWidth = 1;
    c.beginPath(); c.ellipse(w * .5, h * .5, size * (.12 + pulse * .08), size * .25, -.5, 0, Math.PI * 2); c.stroke();
  }
}

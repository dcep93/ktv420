import { seed, type ArtFrame } from './artSceneState';
import { sceneEnergy, sceneLevel } from './sceneMotion';

export function drawBeach({ c, w, h, state }: ArtFrame) {
  const energy = sceneEnergy(state); if (energy < .001) return;
  const t = state.time, bass = sceneLevel(state, 'bass'), drums = sceneLevel(state, 'drums');
  const vocals = sceneLevel(state, 'vocals'), other = sceneLevel(state, 'other');
  const daylight = .5 + .5 * Math.sin(t * Math.PI / 100), horizon = h * .4;
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${224 - daylight * 20} 38% ${8 + daylight * 22}%)`);
  sky.addColorStop(.7, `hsl(${267 - daylight * 75} 36% ${19 + daylight * 25}%)`);
  sky.addColorStop(1, `hsl(${12 + daylight * 22} 68% ${35 + daylight * 27}%)`);
  c.fillStyle = sky; c.fillRect(0, 0, w, horizon);
  if (other > .001) {
    c.fillStyle = `rgba(232,214,203,${other * .13})`;
    for (let i = 0; i < 8; i++) {
      const x = ((seed(i + 43) + t * .0016) % 1.4 - .2) * w, y = h * (.08 + seed(i + 70) * .19);
      c.beginPath(); c.ellipse(x, y, w * (.045 + seed(i) * .065), h * .012, -.04, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = `rgba(21,25,38,${other * .8})`; c.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      const x = ((seed(i + 91) + t * .004) % 1.2 - .1) * w;
      const y = h * (.13 + seed(i + 5) * .16) + Math.sin(t * .6 + i) * h * .009;
      const wing = Math.min(w, h) * .014, flap = Math.sin(t * 2 + i) * wing * .4;
      c.beginPath(); c.moveTo(x - wing, y - flap); c.quadraticCurveTo(x - wing * .4, y - wing * .25, x, y);
      c.quadraticCurveTo(x + wing * .4, y - wing * .25, x + wing, y - flap); c.stroke();
    }
  }
  const sunX = w * (.64 + Math.sin(t * .009) * .12), sunY = horizon - h * (.07 + daylight * .11);
  if (vocals > .001) {
    const radius = Math.min(w, h) * .055;
    const glow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, radius * 5);
    glow.addColorStop(0, `rgba(255,188,146,${vocals * .4})`); glow.addColorStop(1, 'rgba(255,180,140,0)');
    c.fillStyle = glow; c.fillRect(sunX - radius * 5, sunY - radius * 5, radius * 10, radius * 10);
    c.fillStyle = `rgba(255,226,179,${.25 + vocals * .7})`; c.beginPath(); c.arc(sunX, sunY, radius, 0, Math.PI * 2); c.fill();
  }
  const ocean = c.createLinearGradient(0, horizon, 0, h);
  ocean.addColorStop(0, '#344d60'); ocean.addColorStop(.45, '#1b555b'); ocean.addColorStop(.8, '#237b79'); ocean.addColorStop(1, '#87b6a4');
  c.fillStyle = ocean; c.fillRect(0, horizon, w, h - horizon);
  const sand = c.createLinearGradient(0, h * .7, 0, h);
  sand.addColorStop(0, '#9c8d70'); sand.addColorStop(.3, '#ba9b73'); sand.addColorStop(1, '#66513b');
  c.fillStyle = sand; c.beginPath(); c.moveTo(0, h * .83);
  c.bezierCurveTo(w * .3, h * .74, w * .63, h * .91, w, h * .78); c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
  // Perspective-spaced wave fronts advance to shore and fade before wrapping.
  if (bass > .001 || drums > .001) for (let row = 0; row < 16; row++) {
    const p = ((row / 16 + t * .018) % 1), depth = p * p;
    const y = horizon + depth * h * .44, fade = Math.sin(p * Math.PI);
    c.beginPath();
    for (let j = 0; j <= 64; j++) {
      const x = j / 64 * w;
      const swell = Math.sin(j * .11 + t * .38 + row) * h * (.002 + depth * .022) * (.3 + bass);
      const yy = y + swell + Math.sin(j * .31 - t * .7) * depth * h * .003;
      if (!j) c.moveTo(x, yy); else c.lineTo(x, yy);
    }
    c.lineWidth = .6 + depth * h * .012 * bass; c.strokeStyle = `rgba(12,43,52,${fade * bass * .8})`; c.stroke();
    if (drums > .001) {
      c.lineWidth = .5 + depth * h * .003; c.strokeStyle = `rgba(226,237,210,${fade * drums * (.65 + state.audio.pulse * .35)})`; c.stroke();
    }
  }
  if (vocals > .001) {
    c.lineWidth = 1.3;
    for (let i = 0; i < 48; i++) {
      const p = i / 48, y = horizon + p * p * h * .4;
      const x = sunX + Math.sin(i * 2.7 + t * .4) * w * .022 * p;
      const half = (3 + p * p * w * .065) * (.3 + seed(i));
      c.strokeStyle = `rgba(255,211,159,${vocals * (1 - p) * .38})`;
      c.beginPath(); c.moveTo(x - half, y); c.lineTo(x + half, y); c.stroke();
    }
  }
  if (bass > .001 || drums > .001) {
    // A broad, translucent wash meets the sand; the foam lip travels gently.
    const wash = .5 + .5 * Math.sin(t * .42);
    c.beginPath(); c.moveTo(0, h * .81);
    for (let i = 0; i <= 80; i++) {
      const x = i / 80 * w;
      const y = h * (.83 + wash * .035 + Math.sin(i * .065 + t * .13) * .018) + Math.sin(i * .7 + t) * h * .002;
      c.lineTo(x, y);
    }
    c.lineTo(w, h * .78); c.lineTo(0, h * .78); c.closePath();
    c.fillStyle = `rgba(137,191,176,${bass * .48})`; c.fill();
    c.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = i / 80 * w, y = h * (.83 + wash * .035 + Math.sin(i * .065 + t * .13) * .018) + Math.sin(i * .7 + t) * h * .002;
      if (!i) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.lineWidth = 1 + h * .004 * wash; c.strokeStyle = `rgba(229,238,211,${Math.max(bass * .5, drums) * .7})`; c.stroke();
  }
  // A near silhouetted palm frames the open horizon without covering the surf.
  c.strokeStyle = '#252925'; c.fillStyle = '#252925'; c.lineCap = 'round';
  const palmX = w * .09, palmY = h * .21;
  c.lineWidth = Math.min(w, h) * .021;
  c.beginPath(); c.moveTo(w * .025, h); c.quadraticCurveTo(w * .02, h * .49, palmX, palmY); c.stroke();
  for (let i = 0; i < 7; i++) {
    const angle = -Math.PI * .95 + i / 6 * Math.PI * 1.9;
    const length = Math.min(w * .19, h * .42), sway = Math.sin(t * .16 + i) * h * .008;
    const x = palmX + Math.sin(angle) * length, y = palmY + Math.cos(angle) * length * .32 + sway;
    c.beginPath(); c.moveTo(palmX, palmY);
    c.quadraticCurveTo((palmX + x) / 2, Math.min(palmY, y) - h * .12, x, y + h * .08);
    c.quadraticCurveTo((palmX + x) / 2, Math.min(palmY, y) - h * .06, palmX, palmY); c.fill();
  }
  // Foreground sand flecks stay fixed, keeping the shoreline grounded.
  c.fillStyle = 'rgba(238,211,161,.12)';
  for (let i = 0; i < 65; i++) c.fillRect(seed(i + 300) * w, h * (.9 + seed(i + 400) * .1), 1.5, .8);
}

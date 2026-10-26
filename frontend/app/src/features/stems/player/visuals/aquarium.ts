import { color, seed, type ArtFrame } from './artSceneState';
import { reflectedPosition, sceneEnergy, sceneLevel } from './sceneMotion';

export function drawAquarium({ c, w, h, state }: ArtFrame) {
  if (sceneEnergy(state) < .001) return;
  const t = state.time, size = Math.min(w, h), bass = sceneLevel(state, 'bass');
  const drums = sceneLevel(state, 'drums'), vocals = sceneLevel(state, 'vocals'), other = sceneLevel(state, 'other');
  const water = c.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, '#123d49'); water.addColorStop(.45, '#0a253a'); water.addColorStop(1, '#050f20');
  c.fillStyle = water; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const x = w * (i / 5 + Math.sin(t * .07 + i) * .08);
    const ray = c.createLinearGradient(x, 0, x + w * .16, h);
    ray.addColorStop(0, 'rgba(107,211,194,.07)'); ray.addColorStop(1, 'rgba(107,211,194,0)');
    c.fillStyle = ray; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + w * .035, 0); c.lineTo(x + w * .25, h); c.lineTo(x + w * .09, h); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  if (bass > .001) {
    c.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const x = seed(i + 14) * w, height = h * (.12 + seed(i + 73) * .28), sway = Math.sin(t * .3 + i) * size * .035;
      c.strokeStyle = `rgba(${i % 2 ? '51,123,111' : '91,161,129'},${.15 + bass * .55})`; c.lineWidth = size * (.003 + seed(i) * .007);
      c.beginPath(); c.moveTo(x, h); c.bezierCurveTo(x + sway, h - height * .3, x - sway, h - height * .65, x + sway * .5, h - height); c.stroke();
      for (let leaf = 1; leaf <= 3; leaf++) {
        const y = h - height * leaf / 4, side = leaf % 2 ? 1 : -1;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + side * size * .035, y - size * .008, x + sway * .5 + side * size * .026, y - size * .04); c.stroke();
      }
    }
  }
  if (vocals > .001) for (let i = 0; i < 16; i++) {
    const phase = seed(i + 79) * 2, period = 24 + seed(i) * 18;
    const x = size * .05 + (w - size * .1) * reflectedPosition(t, period, phase);
    const direction = ((t / period + phase) % 2) < 1 ? 1 : -1;
    const y = h * (.18 + seed(i + 118) * .55) + Math.sin(t * .5 + i) * h * .025;
    const length = size * (.018 + seed(i + 201) * .025), tail = .6 + .25 * Math.sin(t * 4 + i);
    c.save(); c.translate(x, y); c.scale(direction, 1);
    c.fillStyle = color(i % 3 ? 'vocals' : 'drums', vocals * .7);
    c.beginPath(); c.moveTo(-length * .65, 0); c.lineTo(-length * 1.5, -length * tail); c.lineTo(-length * 1.4, length * tail); c.closePath(); c.fill();
    const body = c.createLinearGradient(0, -length * .4, 0, length * .4);
    body.addColorStop(0, '#f4d8d9'); body.addColorStop(.35, color('vocals', vocals)); body.addColorStop(1, '#694e76');
    c.fillStyle = body; c.beginPath(); c.ellipse(0, 0, length, length * .43, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#07111d'; c.beginPath(); c.arc(length * .6, -length * .06, Math.max(1, length * .09), 0, Math.PI * 2); c.fill(); c.restore();
  }
  if (other > .001) for (let i = 0; i < 5; i++) {
    const radius = size * (.035 + seed(i + 55) * .026);
    const x = radius * 2 + (w - radius * 4) * reflectedPosition(t, 39 + i * 5, seed(i + 711) * 2);
    const y = h * (.13 + .48 * reflectedPosition(t, 30 + i * 7, seed(i + 91) * 2));
    const pulse = 1 + Math.sin(t * 1.2 + i) * .12;
    for (let strand = 0; strand < 7; strand++) {
      c.beginPath(); c.moveTo(x + (strand / 6 - .5) * radius * 1.5, y);
      for (let j = 1; j <= 20; j++) {
        const p = j / 20;
        c.lineTo(x + (strand / 6 - .5) * radius * (1.5 - p * .6) + Math.sin(p * 7 - t * 1.2 + strand) * radius * p * .35, y + p * radius * (2.5 + seed(strand) * 1.5));
      }
      c.strokeStyle = color('other', other * .45); c.lineWidth = 1; c.stroke();
    }
    const bell = c.createRadialGradient(x - radius * .2, y - radius * .4, 0, x, y, radius * 1.3);
    bell.addColorStop(0, color('other', other * .65)); bell.addColorStop(.7, color('other', other * .16)); bell.addColorStop(1, color('other', 0));
    c.fillStyle = bell; c.strokeStyle = color('other', other * .65); c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(x, y, radius * pulse, radius * .85, 0, Math.PI, Math.PI * 2);
    c.quadraticCurveTo(x, y + radius * .3, x - radius * pulse, y); c.fill(); c.stroke();
  }
  if (drums > .001) {
    c.strokeStyle = color('drums', drums * .4); c.lineWidth = .8;
    for (let i = 0; i < 45; i++) {
      const p = (seed(i + 331) + t * (.022 + seed(i) * .025)) % 1;
      const x = seed(i + 141) * w + Math.sin(p * 7 + i) * size * .012;
      c.beginPath(); c.arc(x, h * (1 - p), size * (.0015 + seed(i + 98) * .004), 0, Math.PI * 2); c.stroke();
    }
  }
  c.fillStyle = '#07121b'; c.beginPath(); c.moveTo(0, h);
  for (let i = 0; i <= 32; i++) c.lineTo(i / 32 * w, h * (.96 - seed(i + 19) * .035));
  c.lineTo(w, h); c.closePath(); c.fill();
}

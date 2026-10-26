import { type ArtFrame } from './artSceneState';
import { sceneEnergy, sceneLevel } from './sceneMotion';

export function drawRockShow({ c, w, h, state }: ArtFrame) {
  if (sceneEnergy(state) < .001) return;
  const t = state.time, size = Math.min(w, h), drums = sceneLevel(state, 'drums');
  const bass = sceneLevel(state, 'bass'), vocals = sceneLevel(state, 'vocals'), other = sceneLevel(state, 'other');
  c.fillStyle = '#080711'; c.fillRect(0, 0, w, h);
  const haze = c.createRadialGradient(w * .5, h * .64, 0, w * .5, h * .54, w * .65);
  haze.addColorStop(0, `rgba(86,47,118,${.08 + bass * .35})`); haze.addColorStop(1, 'rgba(35,20,65,0)');
  c.fillStyle = haze; c.fillRect(0, 0, w, h);
  // Three chevron trusses, inspired by layered festival lighting rigs.
  for (let row = 0; row < 3; row++) {
    const y = h * (.08 + row * .17), inset = w * (.05 + row * .08);
    c.strokeStyle = '#252138'; c.lineWidth = 2;
    for (const offset of [0, h * .014]) {
      c.beginPath(); c.moveTo(inset, y + offset); c.lineTo(w * .5, y + h * .09 + offset); c.lineTo(w - inset, y + offset); c.stroke();
    }
    for (let i = 0; i <= 18; i++) {
      const p = i / 18, x = inset + (w - inset * 2) * p;
      const yy = y + (1 - Math.abs(p * 2 - 1)) * h * .09;
      c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w * .012, yy + h * .014); c.stroke();
      const level = Math.sqrt(row === 0 ? other : row === 1 ? vocals : drums);
      if (level < .001) continue;
      const angle = Math.sin(t * .24 + i * .43 + row * 1.6) * .85;
      const endX = x + Math.sin(angle + (p - .5) * .7) * h * .75;
      const endY = h * (.94 + .07 * Math.sin(t * .19 + i));
      const spread = size * (.027 + .04 * (.5 + .5 * Math.sin(t * .17 + i)));
      const rgb = (i + row) % 3 === 0 ? '137,239,216' : (i + row) % 3 === 1 ? '171,111,255' : '237,207,255';
      c.save(); c.globalCompositeOperation = 'lighter';
      const beam = c.createLinearGradient(x, yy, endX, endY);
      beam.addColorStop(0, `rgba(${rgb},${level * .58})`); beam.addColorStop(.65, `rgba(${rgb},${level * .2})`); beam.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = beam; c.beginPath(); c.moveTo(x - 1, yy); c.lineTo(x + 1, yy); c.lineTo(endX + spread, endY); c.lineTo(endX - spread, endY); c.closePath(); c.fill();
      c.strokeStyle = `rgba(${rgb},${level * .3})`; c.lineWidth = .6;
      c.beginPath(); c.moveTo(x, yy); c.lineTo(endX, endY); c.stroke();
      const fixture = c.createRadialGradient(x, yy, 0, x, yy, 9);
      fixture.addColorStop(0, `rgba(${rgb},${level * .7})`); fixture.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = fixture; c.fillRect(x - 9, yy - 9, 18, 18);
      c.fillStyle = `rgba(${rgb},${.25 + level * .7})`; c.beginPath(); c.arc(x, yy, 1.4 + level * 1.2, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }
  if (bass > .001) {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = w * (.13 + i * .123), y = h * 1.02;
      const wash = c.createRadialGradient(x, y, 0, x, y, size * .23);
      wash.addColorStop(0, `rgba(151,91,223,${bass * .25})`); wash.addColorStop(1, 'rgba(151,91,223,0)');
      c.fillStyle = wash; c.fillRect(x - size * .23, y - size * .23, size * .46, size * .46);
      const endX = w * (.5 + Math.sin(t * .18 + i * .8) * .48);
      const up = c.createLinearGradient(x, y, endX, h * .02);
      up.addColorStop(0, `rgba(142,227,205,${Math.sqrt(bass) * .28})`); up.addColorStop(1, 'rgba(142,227,205,0)');
      c.fillStyle = up; c.beginPath(); c.moveTo(x - 1, y); c.lineTo(endX - size * .045, h * .02); c.lineTo(endX + size * .045, h * .02); c.lineTo(x + 1, y); c.closePath(); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
}

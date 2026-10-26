import { beginVisualizer } from './canvas';
import { color, createStemSceneState, seed, updateStemScene, type StemSceneState, type StemVoice } from './stemScene';

export type NewStemScene = 'night-city' | 'stem-garden' | 'stem-orbit';
type Scene = { ctx: CanvasRenderingContext2D; w: number; h: number; time: number; state: StemSceneState };
const states = new WeakMap<HTMLCanvasElement, { kind: NewStemScene; state: StemSceneState }>();
const TAU = Math.PI * 2;
export function resetStemScene(canvas: HTMLCanvasElement) { states.delete(canvas); }

function halo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, tint: string, alpha: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${tint},${alpha})`);
  gradient.addColorStop(1, `rgba(${tint},0)`);
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function nightCity({ ctx, w, h, time, state: { levels, pulse, vocalWave } }: Scene) {
  if (levels.other > .001) {
    for (let layer = 0; layer < 4; layer++) {
      const y = h * (.22 + layer * .12);
      halo(ctx, w * (.2 + layer * .2) + Math.sin(time * .12 + layer) * w * .05, y, h * .65,
        '110,169,180', levels.other * .13);
      ctx.strokeStyle = color('other', levels.other * .16); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const x = i / 48 * w, py = y + Math.sin(i * .13 + time * .14 + layer) * h * .035;
        if (!i) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
  }
  if (levels.bass > .001) {
    for (let layer = 0; layer < 3; layer++) {
      const count = 28 - layer * 5, step = w / count;
      ctx.fillStyle = color('bass', levels.bass * (.12 + layer * .13));
      ctx.strokeStyle = color('bass', levels.bass * (.25 + layer * .18)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i <= count; i++) {
        const roof = h * (1 - (.1 + seed(i + layer * 33) * .46) * (.65 + levels.bass * .35));
        ctx.lineTo(i * step, roof); ctx.lineTo(i * step + step * .8, roof);
        ctx.lineTo(i * step + step * .8, h * .96); ctx.lineTo((i + 1) * step, h * .96);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  if (levels.drums > .001) {
    // A fixed window grid also reads as its own scene when drums are soloed.
    const strength = Math.min(1, levels.drums + pulse);
    for (let column = 0; column < 32; column++) for (let row = 0; row < 5; row++) {
      const glow = seed(column * 7 + row + Math.floor(time * 3) * 11);
      if (glow < .48) continue;
      ctx.fillStyle = color('drums', strength * glow * .9);
      ctx.fillRect((column + .3) / 32 * w, h * (.56 + row * .075), Math.max(2, w / 180), Math.max(2, h * .014));
    }
  }
  if (levels.vocals > .001 && vocalWave) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const p = i / 96, sample = vocalWave[Math.floor(p * (vocalWave.length - 1))];
      const y = h * (.32 + Math.sin(p * 5 + time * .2) * .06) + sample * h * .18;
      if (!i) ctx.moveTo(0, y); else ctx.lineTo(p * w, y);
    }
    ctx.strokeStyle = color('vocals', levels.vocals * .16); ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = color('vocals', levels.vocals * 1.4); ctx.lineWidth = 1.7; ctx.stroke();
  }
}

function stemGarden({ ctx, w, h, time, state: { levels, pulse, vocalWave } }: Scene) {
  const ground = h * .76, center = w * .5;
  if (levels.bass > .001) {
    ctx.strokeStyle = color('bass', levels.bass * .7);
    for (let root = 0; root < 18; root++) {
      const spread = (root / 17 - .5) * w * .9;
      ctx.lineWidth = 1 + levels.bass * (1 + seed(root) * 2);
      ctx.beginPath(); ctx.moveTo(center, ground);
      ctx.bezierCurveTo(center + spread * .12, h * (.79 + levels.bass * .04),
        center + spread * .7, h * (.8 + seed(root + 3) * .1), center + spread, h * (.86 + seed(root + 1) * .12));
      ctx.stroke();
    }
    ctx.strokeStyle = color('bass', levels.bass * .3); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(center, ground, w * .31, h * .025 * (1 + levels.bass), 0, 0, TAU); ctx.stroke();
  }
  if (levels.other > .001) {
    for (let i = 0; i < 24; i++) {
      const p = i / 23, angle = i * 2.4 + Math.sin(time * .23 + i) * .1;
      const x = center + Math.sin(i * 1.7) * w * (.06 + p * .3);
      const y = ground - p * h * .57;
      const length = Math.min(w * .07, h * .12) * (.4 + levels.other * .8) * (1 - p * .3);
      ctx.strokeStyle = color('other', levels.other * .08); ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(center, ground);
      ctx.bezierCurveTo(center, ground - p * h * .2, x, y + h * .08, x, y); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.fillStyle = color('other', levels.other * (.12 + seed(i) * .3));
      ctx.strokeStyle = color('other', levels.other * .55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length * .2, -length * .55, length * .85, -length * .4, length, 0);
      ctx.bezierCurveTo(length * .5, length * .55, length * .15, length * .3, 0, 0);
      ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length * .8, 0); ctx.stroke(); ctx.restore();
    }
  }
  if (levels.vocals > .001 && vocalWave) {
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const p = i / 80, sample = vocalWave[Math.floor(p * (vocalWave.length - 1))];
      const x = center + Math.sin(p * 9 - time * .35) * w * .085 * p + sample * w * .08;
      const y = ground - p * h * .65;
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color('vocals', levels.vocals * .15); ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = color('vocals', levels.vocals * 1.4); ctx.lineWidth = 2; ctx.stroke();
  }
  if (levels.drums > .001) {
    const strength = Math.min(1, levels.drums + pulse);
    ctx.strokeStyle = color('drums', strength * .8); ctx.fillStyle = color('drums', strength * .65); ctx.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const p = (seed(i) + time * (.08 + seed(i + 9) * .05)) % 1;
      const x = w * (.05 + seed(i + 37) * .9) + Math.sin(time * .6 + i) * w * .012;
      const y = ground - p * h * .7, radius = 1 + strength * 2 * (1 - p);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 6); ctx.stroke();
    }
  }
}

function stemOrbit({ ctx, w, h, time, state: { levels, pulse, strikeTime, vocalWave } }: Scene) {
  const cx = w * .5, cy = h * .52, unit = Math.min(h * .34, w * .2);
  if (levels.other > .001) {
    ctx.strokeStyle = color('other', levels.other * .25); ctx.lineWidth = .8;
    ctx.fillStyle = color('other', levels.other * .85);
    for (let group = 0; group < 8; group++) {
      let previousX = 0, previousY = 0;
      const bearing = group / 8 * TAU + time * .018;
      const clusterX = cx + Math.cos(bearing) * w * .33, clusterY = cy + Math.sin(bearing) * h * .34;
      for (let i = 0; i < 5; i++) {
        const n = group * 5 + i;
        const x = clusterX + (seed(n + 50) - .5) * w * .13;
        const y = clusterY + (seed(n + 100) - .5) * h * .18;
        if (i) { ctx.beginPath(); ctx.moveTo(previousX, previousY); ctx.lineTo(x, y); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x, y, .7 + levels.other * seed(n + 3) * 1.8, 0, TAU); ctx.fill();
        previousX = x; previousY = y;
      }
    }
  }
  if (levels.drums > .001) {
    const age = time - strikeTime;
    if (age >= 0 && age < 1.5) for (let ring = 0; ring < 3; ring++) {
      const progress = Math.min(1, age / 1.5 + ring * .15);
      ctx.strokeStyle = color('drums', (1 - progress) * Math.min(1, levels.drums + pulse) * .7);
      ctx.lineWidth = 1 + (1 - progress) * 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, unit * (1 + progress * 3), unit * (.3 + progress), -.18, 0, TAU); ctx.stroke();
    }
    // Continuous percussion keeps a small broken orbit visible between onsets.
    ctx.strokeStyle = color('drums', levels.drums * .5); ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + time * .1;
      ctx.beginPath(); ctx.ellipse(cx, cy, unit * 1.7, unit * .55, -.18, a, a + .08 + levels.drums * .15); ctx.stroke();
    }
  }
  if (levels.bass > .001) {
    const radius = unit * (.2 + levels.bass * .22);
    halo(ctx, cx, cy, radius * 3.5, '201,151,95', levels.bass * .3);
    const gradient = ctx.createRadialGradient(cx - radius * .3, cy - radius * .3, 0, cx, cy, radius);
    gradient.addColorStop(0, color('original', levels.bass)); gradient.addColorStop(.65, color('bass', levels.bass * .85)); gradient.addColorStop(1, color('bass', levels.bass * .15));
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = color('bass', levels.bass * .8); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.15, 0, TAU); ctx.stroke();
  }
  if (levels.vocals > .001 && vocalWave) {
    const orbitX = Math.min(w * .35, unit * 3), orbitY = unit * .9;
    for (let tail = 0; tail < 42; tail++) {
      const p = tail / 41, angle = time * .45 - p * 1.4;
      const sample = vocalWave[Math.floor(p * (vocalWave.length - 1))];
      const x = cx + Math.cos(angle) * orbitX, y = cy + Math.sin(angle) * orbitY + sample * unit * .2 * p;
      ctx.fillStyle = color('vocals', levels.vocals * (1 - p) * .85);
      ctx.beginPath(); ctx.arc(x, y, Math.max(.5, (1 - p) * (2 + levels.vocals * 3)), 0, TAU); ctx.fill();
    }
  }
}

const painters = { 'night-city': nightCity, 'stem-garden': stemGarden, 'stem-orbit': stemOrbit };
export function drawStemScene(kind: NewStemScene, canvas: HTMLCanvasElement, voices: readonly StemVoice[], time: number, playing: boolean) {
  const view = beginVisualizer(canvas); if (!view) return;
  const { context: ctx, width: w, height: h, background } = view;
  try {
    let entry = states.get(canvas);
    if (!entry || entry.kind !== kind) { entry = { kind, state: createStemSceneState() }; states.set(canvas, entry); }
    const state = updateStemScene(entry.state, voices, time, playing);
    ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
    if (state.levels.original > .001) halo(ctx, w * .5, h * .5, Math.max(w, h) * .55, '226,190,141', state.levels.original * .25);
    painters[kind]({ ctx, w, h, time, state });
  } finally { ctx.restore(); }
}

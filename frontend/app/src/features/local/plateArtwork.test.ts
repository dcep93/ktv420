import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlateArtwork, loadPlateArtwork, musicNoteArtwork } from '../stems/player/visuals/plateArtwork';

test('artwork grains preserve geometry, emphasize edges and use deterministic balanced colors', () => {
  const size = 16, pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = x >= 8 ? 128 : 0; pixels[i + 3] = 255;
  }
  const field = analyzePlateArtwork(pixels, size, size);
  assert.deepEqual(field, analyzePlateArtwork(pixels, size, size));
  let edge = 0, body = 0;
  for (let i = 0; i < field.grains.length; i += 4) {
    const x = Math.floor(field.grains[i] * size);
    assert.ok(x >= 7, 'no grains in unrelated empty space');
    if (x === 8) edge = Math.max(edge, field.grains[i + 2]);
    if (x === 12) body = Math.max(body, field.grains[i + 2]);
    assert.ok(Number.isInteger(field.grains[i + 3]) && field.grains[i + 3] >= 0 && field.grains[i + 3] < 4);
  }
  assert.ok(edge > body * 1.5);
});

test('equally bright color boundaries retain strong contours', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i++) { data.set(i % 16 < 8 ? [255, 0, 0, 255] : [0, 76, 0, 255], i * 4); }
  const { grains } = analyzePlateArtwork(data, 16, 16);
  const weights = new Map<number, number>();
  for (let i = 0; i < grains.length; i += 4) weights.set(Math.floor(grains[i] * 16), grains[i + 2]);
  assert.ok(weights.get(7)! > weights.get(2)! * 2);
  assert.ok(weights.get(8)! > weights.get(12)! * 2);
});

test('missing and canceled artwork use the bounded music-note fallback', async () => {
  const controller = new AbortController();
  assert.equal(await loadPlateArtwork('', controller.signal), musicNoteArtwork);
  controller.abort(); assert.equal(await loadPlateArtwork('unused', controller.signal), musicNoteArtwork);
  assert.ok(musicNoteArtwork.grains.length > 1000);
  assert.ok(musicNoteArtwork.grains.length <= 128 * 128 * 4);
});

test('a failed or canceled image load settles safely and detaches its callbacks', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const images: { src: string; onload: null | (() => void); onerror: null | (() => void) }[] = [];
  class FakeImage {
    src = ''; onload = null; onerror = null;
    constructor() { images.push(this); }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  try {
    const controller = new AbortController();
    const canceled = loadPlateArtwork('old-cover', controller.signal);
    controller.abort(); assert.equal(await canceled, musicNoteArtwork);
    assert.equal(images[0].src, ''); assert.equal(images[0].onload, null);
    const failed = loadPlateArtwork('broken-cover', new AbortController().signal);
    images[1].onerror!(); assert.equal(await failed, musicNoteArtwork);
    assert.equal(images[1].onload, null); assert.equal(images[1].onerror, null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Image', previous);
    else Reflect.deleteProperty(globalThis, 'Image');
  }
});

test('fully lit artwork remains bounded, pause-stable and independent of Original', async () => {
  const { drawPlate } = await import('../stems/player/visuals/resonancePlate');
  const { createArtState } = await import('../stems/player/visuals/artSceneState');
  const field = analyzePlateArtwork(new Uint8ClampedArray(128 * 128 * 4).fill(255), 128, 128);
  const state = createArtState(); state.time = 14;
  Object.assign(state.audio.levels, { drums: 1, bass: 1, vocals: 1, other: 1 });
  const marks: number[][] = [], colors: string[] = [];
  const c = { set fillStyle(value: string) { colors.push(value); }, beginPath() {}, fill() {},
    rect(...args: number[]) { args.forEach(value => assert.ok(Number.isFinite(value))); marks.push(args); } } as unknown as CanvasRenderingContext2D;
  drawPlate({ c, w: 2400, h: 1200, state }, field);
  assert.equal(colors.length, 4); assert.equal(marks.length, 128 * 128);
  const before = structuredClone(marks); marks.length = 0;
  drawPlate({ c, w: 2400, h: 1200, state }, field); assert.deepEqual(marks, before);
  // The original must neither brighten active stems nor resurrect muted colors.
  state.audio.levels.original = 1; marks.length = 0;
  const beforeColors = [...colors]; colors.length = 0;
  drawPlate({ c, w: 2400, h: 1200, state }, field);
  assert.deepEqual(marks, before); assert.deepEqual(colors, beforeColors.slice(0, colors.length));
  Object.assign(state.audio.levels, { drums: 0, bass: 0, vocals: 0, other: 0 }); marks.length = colors.length = 0;
  drawPlate({ c, w: 2400, h: 1200, state }, field); assert.equal(marks.length, 0);
});

test('plate has no brightness floor, suppresses averages, and preserves peaks without Original', async () => {
  const { drawPlate } = await import('../stems/player/visuals/resonancePlate');
  const { createArtState } = await import('../stems/player/visuals/artSceneState');
  const state = createArtState();
  const colors: string[] = [];
  const c = { set fillStyle(value: string) { colors.push(value); }, beginPath() {}, fill() {}, rect() {} } as unknown as CanvasRenderingContext2D;
  const alpha = (value: string) => Number(value.slice(value.lastIndexOf(',') + 1, -1));
  let previous = 0;
  for (const level of [.01, .1, .5, .8, 1]) {
    state.audio.levels.vocals = level; state.audio.levels.original = 1; colors.length = 0;
    drawPlate({ c, w: 800, h: 400, state }, { width: 1, height: 1, grains: new Float32Array([.5,.5,1,2]) });
    assert.equal(colors.length, 1, 'Original cannot enable the three silent stems');
    const after = alpha(colors[0]);
    assert.ok(after > previous); previous = after;
    if (level === .01) assert.ok(after < .00001, 'near silence must not retain a brightness floor');
    if (level === .5) assert.equal(after, .125);
    if (level === 1) assert.equal(after, 1);
    else assert.ok(after < level * level);
  }
});

async function renderGrain(role: number, levels: number[], time = 0) {
  const { drawPlate } = await import('../stems/player/visuals/resonancePlate');
  const { createArtState } = await import('../stems/player/visuals/artSceneState');
  const state = createArtState(); state.time = time;
  const roles = ['drums', 'bass', 'vocals', 'other'] as const;
  roles.forEach((role, i) => { state.audio.levels[role] = levels[i]; });
  const paints: number[][] = [];
  let style = '', rectangles = 0;
  const c = { set fillStyle(value: string) { style = value; }, beginPath() { rectangles = 0; }, rect() { rectangles++; },
    fill() { for (let i = 0; i < rectangles; i++) paints.push(style.match(/[+-]?(?:\d*\.?\d+)(?:e[+-]?\d+)?/gi)!.map(Number)); } } as unknown as CanvasRenderingContext2D;
  drawPlate({ c, w: 100, h: 100, state }, { width: 1, height: 1, grains: new Float32Array([.5, .5, 1, role]) });
  return paints;
}

test('every grain keeps one exact palette color at all times and levels', async () => {
  const palette = [[230,181,115], [190,144,93], [255,123,195], [130,192,190]];
  for (let role = 0; role < 4; role++) for (const time of [0,7,21,56,1000]) {
    const paints = await renderGrain(role, [1,.8,.5,.1], time);
    assert.equal(paints.length, 1);
    assert.deepEqual(paints[0].slice(0,3), palette[role]);
    assert.equal(paints[0][3], [1,.8,.5,.1][role] ** 3);
  }
});

test('muted pixels disappear without changing or reallocating neighboring colors', async () => {
  assert.deepEqual(await renderGrain(0, [0,1,1,1]), []);
  assert.deepEqual(await renderGrain(1, [0,1,1,1]), [[190,144,93,1]]);
  assert.deepEqual(await renderGrain(2, [0,0,.5,0]), [[255,123,195,.125]]);
});

test('balanced image pixels stay within their own cells at full brightness', async () => {
  const { drawPlate } = await import('../stems/player/visuals/resonancePlate');
  const { createArtState } = await import('../stems/player/visuals/artSceneState');
  const artwork = analyzePlateArtwork(new Uint8ClampedArray(16*16*4).fill(255),16,16);
  const state = createArtState(); Object.assign(state.audio.levels,{drums:1,bass:1,vocals:1,other:1});
  const shares = [0,0,0,0];
  for(let i=3;i<artwork.grains.length;i+=4) shares[artwork.grains[i]]++;
  assert.deepEqual(shares,[64,64,64,64]);
  const marks:number[][]=[];
  const c={beginPath(){},fill(){},rect(...args:number[]){marks.push(args);}} as unknown as CanvasRenderingContext2D;
  drawPlate({c,w:160,h:160,state},artwork);
  const scale=9,left=8,top=8;
  for(const [x,y,w,h] of marks){
    const col=Math.floor((x+w/2-left)/scale),row=Math.floor((y+h/2-top)/scale);
    assert.ok(x>=left+col*scale && x+w<=left+(col+1)*scale);
    assert.ok(y>=top+row*scale && y+h<=top+(row+1)*scale);
  }
  const before=structuredClone(marks);marks.length=0;state.time=100;
  drawPlate({c,w:160,h:160,state},artwork);assert.deepEqual(marks,before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlateArtwork, loadPlateArtwork, musicNoteArtwork } from '../stems/player/visuals/plateArtwork';

test('artwork grains preserve geometry, emphasize edges and use deterministic noise', () => {
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
    assert.ok(field.grains[i + 3] >= 0 && field.grains[i + 3] < 4);
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

test('fully lit artwork remains bounded, pause-stable and uses only four colors', async () => {
  const { drawPlate } = await import('../stems/player/visuals/resonancePlate');
  const { createArtState } = await import('../stems/player/visuals/artSceneState');
  const field = analyzePlateArtwork(new Uint8ClampedArray(128 * 128 * 4).fill(255), 128, 128);
  const state = createArtState(); state.time = 14; state.audio.levels.original = .5;
  const marks: number[][] = [], colors: string[] = [];
  const c = { set fillStyle(value: string) { colors.push(value); }, beginPath() {}, fill() {},
    rect(...args: number[]) { args.forEach(value => assert.ok(Number.isFinite(value))); marks.push(args); } } as unknown as CanvasRenderingContext2D;
  drawPlate({ c, w: 2400, h: 1200, state }, field);
  assert.equal(colors.length, 4); assert.ok(marks.length <= 128 * 128 * 2);
  const before = structuredClone(marks); marks.length = 0;
  drawPlate({ c, w: 2400, h: 1200, state }, field); assert.deepEqual(marks, before);
  state.audio.levels.original = 0; marks.length = colors.length = 0;
  drawPlate({ c, w: 2400, h: 1200, state }, field); assert.equal(marks.length, 0);
});

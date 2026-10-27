import { balancedPlatePalette } from './platePalette';

export const PLATE_SIZE = 128;
export type PlateArtwork = { width: number; height: number; grains: Float32Array };

// Four values per grain: anchored x/y, visual weight, fixed palette index.
// RGB gradients preserve boundaries even between colors of equal luminance.
export function analyzePlateArtwork(data: Uint8ClampedArray, width: number, height: number): PlateArtwork {
  const grains: number[] = [], colors: number[] = [];
  const sample = (x: number, y: number, channel: number) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return data[i + channel] / 255 * data[i + 3] / 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const luminance = .2126 * sample(x, y, 0) + .7152 * sample(x, y, 1) + .0722 * sample(x, y, 2);
    let edge = 0;
    for (let channel = 0; channel < 3; channel++) {
      const dx = sample(x + 1, y, channel) - sample(x - 1, y, channel);
      const dy = sample(x, y + 1, channel) - sample(x, y - 1, channel);
      edge = Math.max(edge, Math.hypot(dx, dy));
    }
    const weight = Math.min(1, .8 * Math.pow(luminance, .85) + .85 * edge);
    if (weight < .035) continue;
    grains.push((x + .5) / width, (y + .5) / height, weight, 0);
    colors.push(sample(x, y, 0) * 255, sample(x, y, 1) * 255, sample(x, y, 2) * 255);
  }
  const assignments = balancedPlatePalette(colors);
  assignments.forEach((role, i) => { grains[i * 4 + 3] = role; });
  return { width, height, grains: new Float32Array(grains) };
}

function musicNotes() {
  const data = new Uint8ClampedArray(PLATE_SIZE * PLATE_SIZE * 4);
  for (let y = 0; y < PLATE_SIZE; y++) for (let x = 0; x < PLATE_SIZE; x++) {
    const u = x / PLATE_SIZE, v = y / PLATE_SIZE;
    const note = ((u - .32) / .105) ** 2 + ((v - .72 + (u - .32) * .35) / .07) ** 2 < 1 ||
      ((u - .69) / .105) ** 2 + ((v - .62 + (u - .69) * .35) / .07) ** 2 < 1;
    const stems = (u > .365 && u < .414 && v > .26 && v < .72) || (u > .735 && u < .784 && v > .16 && v < .62);
    const beam = u > .365 && u < .784 && v > .26 - (u - .365) * .27 && v < .34 - (u - .365) * .27;
    const i = (y * PLATE_SIZE + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = note || stems || beam ? 255 : 0; data[i + 3] = 255;
  }
  return analyzePlateArtwork(data, PLATE_SIZE, PLATE_SIZE);
}
export const musicNoteArtwork = musicNotes();

// No persistent image cache: only the current bounded field survives in Player.
export function loadPlateArtwork(src: string, signal: AbortSignal): Promise<PlateArtwork> {
  if (!src || signal.aborted) return Promise.resolve(musicNoteArtwork);
  return new Promise(resolve => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    const finish = (field = musicNoteArtwork) => {
      clearTimeout(timeout); image.onload = image.onerror = null;
      signal.removeEventListener('abort', cancel); resolve(field);
    };
    const cancel = () => { finish(); image.src = ''; };
    const timeout = setTimeout(cancel, 10000);
    signal.addEventListener('abort', cancel, { once: true });
    image.onerror = () => finish();
    image.onload = () => {
      try {
        const scale = PLATE_SIZE / Math.max(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { finish(); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        finish(analyzePlateArtwork(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
      } catch { finish(); } // Includes CORS/tainted canvas: the note remains usable.
    };
    image.src = src;
  });
}

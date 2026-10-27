import { stemRoles, type ArtFrame } from './artSceneState';
import { sceneColors } from './stemScene';
import { musicNoteArtwork, type PlateArtwork } from './plateArtwork';

const PHASE_STEPS = 32;
const BUCKETS = PHASE_STEPS * 4;
const palette = stemRoles.slice(0, 4).map(role => sceneColors[role].split(',').map(Number));
const artworkBuckets = new WeakMap<PlateArtwork, number[][]>();
function bucketsFor(artwork: PlateArtwork) {
  let buckets = artworkBuckets.get(artwork);
  if (!buckets) {
    buckets = Array.from({ length: BUCKETS }, () => [] as number[]);
    for (let i = 0; i < artwork.grains.length; i += 4) {
      buckets[Math.round(artwork.grains[i + 3] * PHASE_STEPS) % BUCKETS].push(i);
    }
    artworkBuckets.set(artwork, buckets);
  }
  return buckets;
}

export function drawPlate({ c, w, h, state }: ArtFrame, artwork: PlateArtwork = musicNoteArtwork) {
  const scale = Math.min(w * .9 / artwork.width, h * .91 / artwork.height);
  const width = artwork.width * scale, height = artwork.height * scale;
  const left = (w - width) / 2, top = (h - height) / 2;
  const travel = state.time / 14;
  const buckets = bucketsFor(artwork);
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const indices = buckets[bucket];
    if (!indices.length) continue;
    // Only initial noise phases are grouped; playback-time crossfades remain
    // continuous. Each grain is painted once, without a later stem covering it.
    const phase = (bucket / PHASE_STEPS + travel) % 4;
    const first = Math.floor(phase), second = (first + 1) % 4;
    const blend = .5 + .5 * Math.cos((phase - first) * Math.PI);
    const a = Math.max(0, Math.min(1, state.audio.levels[stemRoles[first]]));
    const b = Math.max(0, Math.min(1, state.audio.levels[stemRoles[second]]));
    const contributionA = blend * a ** 3, contributionB = (1 - blend) * b ** 3;
    const alpha = contributionA + contributionB;
    if (alpha <= 0) continue;
    // Premultiplied blending: a muted stem contributes neither color nor opacity.
    // Equal adjacent levels retain exactly the existing cubic brightness curve.
    const mix = contributionB / alpha;
    const red = palette[first][0] + (palette[second][0] - palette[first][0]) * mix;
    const green = palette[first][1] + (palette[second][1] - palette[first][1]) * mix;
    const blue = palette[first][2] + (palette[second][2] - palette[first][2]) * mix;
    c.fillStyle = `rgba(${red},${green},${blue},${alpha})`; c.beginPath();
    const size = scale * Math.sqrt(blend * (1.08 + .18 * a) ** 2 + (1 - blend) * (1.08 + .18 * b) ** 2);
    for (const i of indices) {
      const grain = size * Math.sqrt(artwork.grains[i + 2]);
      const x = left + artwork.grains[i] * width, y = top + artwork.grains[i + 1] * height;
      c.rect(x - grain / 2, y - grain / 2, grain, grain);
    }
    c.fill();
  }
}

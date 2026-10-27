import { stemRoles, type ArtFrame } from './artSceneState';
import { sceneColors } from './stemScene';
import { musicNoteArtwork, type PlateArtwork } from './plateArtwork';

const artworkGroups = new WeakMap<PlateArtwork, number[][]>();
function groupsFor(artwork: PlateArtwork) {
  let groups = artworkGroups.get(artwork);
  if (!groups) {
    groups = Array.from({ length: 4 }, () => [] as number[]);
    for (let i = 0; i < artwork.grains.length; i += 4) groups[artwork.grains[i + 3]].push(i);
    artworkGroups.set(artwork, groups);
  }
  return groups;
}

export function drawPlate({ c, w, h, state }: ArtFrame, artwork: PlateArtwork = musicNoteArtwork) {
  const scale = Math.min(w * .9 / artwork.width, h * .91 / artwork.height);
  const width = artwork.width * scale, height = artwork.height * scale;
  const left = (w - width) / 2, top = (h - height) / 2;
  const groups = groupsFor(artwork);
  for (let role = 0; role < 4; role++) {
    const indices = groups[role];
    const level = Math.max(0, Math.min(1, state.audio.levels[stemRoles[role]]));
    if (!indices.length || level <= 0) continue;
    c.fillStyle = `rgba(${sceneColors[stemRoles[role]]},${level ** 3})`; c.beginPath();
    for (const i of indices) {
      // Fixed cells cannot overlap. Audio changes opacity, never color or location.
      const grain = scale * .92 * Math.sqrt(artwork.grains[i + 2]);
      const x = left + artwork.grains[i] * width, y = top + artwork.grains[i + 1] * height;
      c.rect(x - grain / 2, y - grain / 2, grain, grain);
    }
    c.fill();
  }
}

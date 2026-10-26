import { stemRoles, type ArtFrame } from './artSceneState';
import { sceneColors } from './stemScene';
import { musicNoteArtwork, type PlateArtwork } from './plateArtwork';

export function drawPlate({ c, w, h, state }: ArtFrame, artwork: PlateArtwork = musicNoteArtwork) {
  const scale = Math.min(w * .9 / artwork.width, h * .91 / artwork.height);
  const width = artwork.width * scale, height = artwork.height * scale;
  const left = (w - width) / 2, top = (h - height) / 2;
  // Color migrates, but every grain stays on its artwork contour. Smooth cyclic
  // crossfades avoid random-per-frame sparkle, including at palette wraparound.
  const travel = state.time / 14;
  for (let role = 0; role < 4; role++) {
    const level = state.audio.levels[stemRoles[role]];
    if (level < .001) continue;
    // No brightness floor or shared quiet-detail boost: half level is 12.5%
    // opacity, while full peaks retain 100% of the four original palette colors.
    c.fillStyle = `rgba(${sceneColors[stemRoles[role]]},${Math.min(1, level) ** 3})`; c.beginPath();
    for (let i = 0; i < artwork.grains.length; i += 4) {
      const phase = (artwork.grains[i + 3] + travel) % 4;
      const distance = Math.min(Math.abs(phase - role), 4 - Math.abs(phase - role));
      if (distance >= 1) continue;
      const blend = .5 + .5 * Math.cos(distance * Math.PI);
      const weight = artwork.grains[i + 2];
      const grain = scale * Math.sqrt(weight * blend) * (1.08 + .18 * level);
      const x = left + artwork.grains[i] * width, y = top + artwork.grains[i + 1] * height;
      c.rect(x - grain / 2, y - grain / 2, grain, grain);
    }
    c.fill();
  }
}

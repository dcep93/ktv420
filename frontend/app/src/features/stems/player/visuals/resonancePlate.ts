import { color, stemRoles, type ArtFrame } from './artSceneState';
import { musicNoteArtwork, type PlateArtwork } from './plateArtwork';

export function drawPlate({ c, w, h, state }: ArtFrame, artwork: PlateArtwork = musicNoteArtwork) {
  const scale = Math.min(w * .9 / artwork.width, h * .91 / artwork.height);
  const width = artwork.width * scale, height = artwork.height * scale;
  const left = (w - width) / 2, top = (h - height) / 2;
  // Color migrates, but every grain stays on its artwork contour. Smooth cyclic
  // crossfades avoid random-per-frame sparkle, including at palette wraparound.
  const travel = state.time / 14;
  for (let role = 0; role < 4; role++) {
    const level = Math.max(state.audio.levels[stemRoles[role]], state.audio.levels.original);
    if (level < .001) continue;
    // Squaring before color's power curve also squares the final rendered alpha.
    c.fillStyle = color(stemRoles[role], (.55 + .45 * level) ** 2); c.beginPath();
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

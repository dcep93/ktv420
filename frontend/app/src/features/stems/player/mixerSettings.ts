import type { MixerSnapshot } from '../../local/recording';
import { getDefaultEffectValue } from './audioEffects';
import type { Track } from './types';
import { visualizerOptions } from './visualizerOptions';

/** Carry mixer choices between songs without retaining song-specific IDs or clocks. */
export function settingsForTracks(saved: MixerSnapshot | null | undefined, tracks: Pick<Track, 'name' | 'isInput'>[]): MixerSnapshot {
  const spotlight = saved?.spotlight;
  const hasSpotlight = spotlight && tracks.some(track => spotlight.intent.kind === 'input'
    ? track.isInput : !track.isInput && track.name === spotlight.intent.name);
  return {
    tempo: saved?.tempo ?? 1, pitch: saved?.pitch ?? 0,
    visualizer: saved?.visualizer ?? visualizerOptions[0].value,
    spotlight: hasSpotlight ? structuredClone(spotlight) : null,
    stems: tracks.map(track => {
      const previous = saved?.stems.find(stem => stem.name === track.name && stem.input === track.isInput);
      return previous ? {...previous} : {
        name:track.name, input:track.isInput, volume:1,
        mute:track.isInput && tracks.some(candidate => !candidate.isInput), deafen:false,
        effect:'wah', value:getDefaultEffectValue('wah'),
      };
    }),
  };
}

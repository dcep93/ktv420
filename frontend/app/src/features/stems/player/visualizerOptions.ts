import { type VisualizerType } from "./types";

export const visualizerOptions: Array<{
  value: VisualizerType;
  label: string;
  hint: string;
}> = [
  { value: "beach", label: "Beach", hint: "Sunlit surf and a changing sky" },
  { value: "aquarium", label: "Aquarium", hint: "A living underwater mix" },
  { value: "rock-show", label: "Rock Show", hint: "A stage full of light" },
  { value: "disco-ball", label: "Disco Ball", hint: "Turning mirrors and scattered light" },
  { value: "time-ribbon", label: "Time Ribbon", hint: "Amplitude Timeline" },
  { value: "signal-loom", label: "Signal Loom", hint: "The mix weaves light" },
  { value: "ink-tank", label: "Ink Tank", hint: "Flowing stem pigments" },
  { value: "resonance-plate", label: "Resonance Plate", hint: "Frequency becomes sand" },
  { value: "glassworks", label: "Glassworks", hint: "The mix lights stained glass" },
  { value: "stem-weather", label: "Stem Weather", hint: "The whole mix" },
  { value: "night-city", label: "Night City", hint: "The mix lights a skyline" },
  { value: "stem-garden", label: "Stem Garden", hint: "The mix grows a garden" },
  { value: "stem-orbit", label: "Orbit", hint: "The mix becomes a solar system" },
  { value: "spectrogram", label: "Spectrogram", hint: "Frequency history" },
  { value: "stereo-bloom", label: "Stereo Bloom", hint: "Left / right image" },
  { value: "laser-ladders", label: "Laser Ladders", hint: "Graphic EQ" },
  { value: "spectrum-safari", label: "Spectrum Safari", hint: "Analyzer" },
  {
    value: "waveform-waterline",
    label: "Waveform Waterline",
    hint: "Oscilloscope",
  },
  { value: "aurora-radar", label: "Aurora Radar", hint: "Radial Sweep" },
  { value: "mirror-peaks", label: "Mirror Peaks", hint: "Symmetric Bars" },
  { value: "pulse-grid", label: "Pulse Grid", hint: "Energy Matrix" },
  { value: "luminous-orbit", label: "Luminous Orbit", hint: "Layered Rings" },
  { value: "prism-bloom", label: "Prism Bloom", hint: "Radiant Arcs" },
  {
    value: "cascade-horizon",
    label: "Cascade Horizon",
    hint: "Layered Terrain",
  },
  { value: "nebula-trails", label: "Nebula Trails", hint: "Shimmering Path" },
  { value: "echo-lantern", label: "Echo Lantern", hint: "Glowing Ripples" },
  { value: "ember-mandala", label: "Ember Mandala", hint: "Radiant Petals" },
  { value: "hippie-mirage", label: "Hippie Mirage", hint: "Tie-Dye Bloom" },
  { value: "hollow-echoes", label: "Hollow Echoes", hint: "Stacked Pillars" },
  { value: "opal-current", label: "Opal Current", hint: "Opalescent Waves" },
  { value: "solstice-waves", label: "Solstice Waves", hint: "Solar Horizon" },
  { value: "ripple-weave", label: "Ripple Weave", hint: "Braided Ribbons" },
  { value: "ectoplasm", label: "Ectoplasm", hint: "Plasma Bloom" },
  {
    value: "super-time-ribbon",
    label: "Super Time Ribbon",
    hint: "Prismatic trails & beat sparks",
  },
  {
    value: "prismatic-turbine",
    label: "Prismatic Turbine",
    hint: "Whirling Shards",
  },
  { value: "kaleidoscope", label: "Kaleidoscope", hint: "Mirrored Lenses" },
  { value: "highway", label: "Highway", hint: "The mix drives a neon desert" },
];

// Retired picker entries still render faithfully in saved replays.
export function supportsVisualizer(value: string): value is VisualizerType {
  return value === "delay-pedal" || visualizerOptions.some(option => option.value === value);
}

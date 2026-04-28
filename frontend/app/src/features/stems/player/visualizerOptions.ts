import { type VisualizerType } from "./types";

export const visualizerOptions: Array<{
  value: VisualizerType;
  label: string;
  hint: string;
}> = [
  { value: "time-ribbon", label: "Time Ribbon", hint: "Amplitude Timeline" },
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
    hint: "Shaking Ribbon",
  },
  {
    value: "prismatic-turbine",
    label: "Prismatic Turbine",
    hint: "Whirling Shards",
  },
  { value: "kaleidoscope", label: "Kaleidoscope", hint: "Mirrored Lenses" },
  { value: "highway", label: "Highway", hint: "Retro Neon Run" },
  { value: "delay-pedal", label: "Delay Pedal", hint: "Echo Ripples" },
];

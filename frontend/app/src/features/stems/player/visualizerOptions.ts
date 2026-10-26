import { type VisualizerType } from "./types";

type VisualizerOption = { value: VisualizerType; label: string; hint: string };

export const visualizerGroups: Array<{ label: string; options: VisualizerOption[] }> = [
  { label: "Signal", options: [
    { value: "time-ribbon", label: "Time Ribbon", hint: "Amplitude Timeline" },
    { value: "super-time-ribbon", label: "Super Time Ribbon", hint: "Prismatic trails & beat sparks" },
    { value: "pitch-ribbon", label: "Pitch Ribbon", hint: "Pitch & volume over time" },
    { value: "waveform-waterline", label: "Waveform Waterline", hint: "Oscilloscope" },
    { value: "spectrum-safari", label: "Spectrum Safari", hint: "Analyzer" },
    { value: "laser-ladders", label: "Laser Ladders", hint: "Graphic EQ" },
    { value: "hollow-echoes", label: "Hollow Echoes", hint: "Stacked Pillars" },
    { value: "mirror-peaks", label: "Mirror Peaks", hint: "Symmetric Bars" },
    { value: "pulse-grid", label: "Pulse Grid", hint: "Energy Matrix" },
    { value: "stereo-bloom", label: "Stereo Bloom", hint: "Left / right image" },
    { value: "nebula-trails", label: "Nebula Trails", hint: "Shimmering Path" },
    { value: "cascade-horizon", label: "Cascade Horizon", hint: "Layered Terrain" },
    { value: "spectrogram", label: "Spectrogram", hint: "Frequency history" },
  ] },
  { label: "Scenes", options: [
    { value: "highway", label: "Highway", hint: "The mix drives a neon desert" },
    { value: "beach", label: "Beach", hint: "Sunlit surf and a changing sky" },
    { value: "stem-weather", label: "Stem Weather", hint: "The whole mix" },
    { value: "night-city", label: "Night City", hint: "The mix lights a skyline" },
    { value: "stem-garden", label: "Stem Garden", hint: "The mix grows a garden" },
    { value: "stem-orbit", label: "Orbit", hint: "The mix becomes a solar system" },
    { value: "aquarium", label: "Aquarium", hint: "A living underwater mix" },
    { value: "ink-tank", label: "Ink Tank", hint: "Flowing stem pigments" },
    { value: "rock-show", label: "Rock Show", hint: "Sweeping concert lights" },
    { value: "disco-ball", label: "Disco Ball", hint: "Turning mirrors and scattered light" },
    { value: "glassworks", label: "Glassworks", hint: "The mix lights stained glass" },
    { value: "resonance-plate", label: "Resonance Plate", hint: "Frequency becomes sand" },
    { value: "signal-loom", label: "Signal Loom", hint: "The mix weaves light" },
  ] },
  { label: "Patterns", options: [
    { value: "kaleidoscope", label: "Kaleidoscope", hint: "Mirrored Lenses" },
    { value: "hippie-mirage", label: "Hippie Mirage", hint: "Tie-Dye Bloom" },
    { value: "ember-mandala", label: "Ember Mandala", hint: "Radiant Petals" },
    { value: "prism-bloom", label: "Prism Bloom", hint: "Radiant Arcs" },
    { value: "prismatic-turbine", label: "Prismatic Turbine", hint: "Whirling Shards" },
    { value: "luminous-orbit", label: "Luminous Orbit", hint: "Layered Rings" },
    { value: "aurora-radar", label: "Aurora Radar", hint: "Radial Sweep" },
    { value: "echo-lantern", label: "Echo Lantern", hint: "Glowing Ripples" },
    { value: "ectoplasm", label: "Ectoplasm", hint: "Plasma Bloom" },
    { value: "opal-current", label: "Opal Current", hint: "Opalescent Waves" },
    { value: "ripple-weave", label: "Ripple Weave", hint: "Braided Ribbons" },
    { value: "solstice-waves", label: "Solstice Waves", hint: "Solar Horizon" },
  ] },
];

// Keyboard cycling follows the same order as the grouped picker.
export const visualizerOptions = visualizerGroups.flatMap(group => group.options);

// Retired picker entries still render faithfully in saved replays.
export function supportsVisualizer(value: string): value is VisualizerType {
  return value === "delay-pedal" || visualizerOptions.some(option => option.value === value);
}

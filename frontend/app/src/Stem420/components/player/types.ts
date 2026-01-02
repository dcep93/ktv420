import { type CachedOutputRecord } from "../../indexedDbClient";

export type CachedTrackFile = CachedOutputRecord["files"][number];

export type VisualizerType =
  | "laser-ladders"
  | "spectrum-safari"
  | "time-ribbon"
  | "waveform-waterline"
  | "aurora-radar"
  | "mirror-peaks"
  | "pulse-grid"
  | "luminous-orbit"
  | "prism-bloom"
  | "cascade-horizon"
  | "nebula-trails"
  | "echo-lantern"
  | "ember-mandala"
  | "hippie-mirage"
  | "hollow-echoes"
  | "opal-current"
  | "solstice-waves"
  | "ripple-weave"
  | "ectoplasm"
  | "static-shock"
  | "snowstorm"
  | "kaleidoscope"
  | "highway"
  | "delay-pedal";

export type PlayerProps = {
  record: CachedOutputRecord;
  onClose: () => void;
};

export type Track = {
  id: string;
  name: string;
  path: string;
  isInput: boolean;
  url: string;
  blob: Blob;
};

export const PAST_WINDOW_SECONDS = 5;
export const FUTURE_WINDOW_SECONDS = 15;
export const AMPLITUDE_WINDOW_SECONDS = 0.05;

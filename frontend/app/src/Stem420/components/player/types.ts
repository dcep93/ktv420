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
  | "nebula-trails";

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

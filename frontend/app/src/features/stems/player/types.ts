export type PlaybackFile = {
  name: string;
  path: string;
  blob: Blob;
};

export type PlaybackRecord = {
  md5: string;
  files: PlaybackFile[];
};

export type CachedTrackFile = PlaybackFile;

export type RecordingEventType =
  | "record_start_snapshot"
  | "track_started"
  | "record_stop"
  | "transport_play"
  | "transport_pause"
  | "seek_commit"
  | "volume_change"
  | "volume_reset"
  | "mute_toggle"
  | "deafen_toggle"
  | "effect_type_change"
  | "effect_value_change"
  | "effect_reset"
  | "spotlight_toggle"
  | "visualizer_change";

export type RecordingEventPayload = Record<string, unknown> | null;

export type RecordingEvent = {
  type: RecordingEventType;
  trackTimeSeconds: number;
  payload?: RecordingEventPayload;
};

export type PlaybackRecording = {
  version: 1;
  name: string;
  createdAt: string;
  trackIds: string[];
  events: RecordingEvent[];
};

export type RecordingStartRequest = {
  trackTimeSeconds: number;
  snapshotPayload?: RecordingEventPayload;
};

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
  | "super-time-ribbon"
  | "prismatic-turbine"
  | "kaleidoscope"
  | "highway"
  | "delay-pedal";

export type PlayerProps = {
  record: PlaybackRecord;
  title?: string;
  trackMetadata?: Record<string, unknown> | null;
  unavailableMessage?: string;
  hasPreviousTrack?: boolean;
  hasNextTrack?: boolean;
  autoPlayOnReady?: boolean;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  onTrackEnd?: () => void;
  onAutoPlayOnReadyHandled?: () => void;
  isRecording?: boolean;
  onStartRecording?: (request: RecordingStartRequest) => Promise<boolean>;
  onStopRecording?: (event: RecordingEvent) => Promise<void>;
  onRecordingEvent?: (event: RecordingEvent) => void;
  onRegisterRecordingFlush?: (flush: (() => void) | null) => void;
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

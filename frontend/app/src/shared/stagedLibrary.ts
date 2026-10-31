export type StagedAudio = {
  id: string;
  trackId?: string;
  title: string;
  bytes: number;
  ready: boolean;
  busy: boolean;
};

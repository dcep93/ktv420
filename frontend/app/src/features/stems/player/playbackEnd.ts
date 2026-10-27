/** A silent audio-clock deadline. Unlike animation frames, ended events run in background tabs. */
export class PlaybackEnd {
  private source: AudioBufferSourceNode | null = null;
  private silence: AudioBuffer;
  private context: BaseAudioContext;
  private ended: () => void;
  constructor(context: BaseAudioContext, ended: () => void) {
    this.context = context;
    this.ended = ended;
    this.silence = context.createBuffer(1, 1, context.sampleRate);
  }
  schedule(when: number) {
    this.cancel();
    const source = this.context.createBufferSource();
    this.source = source;
    source.buffer = this.silence;
    source.loop = true;
    source.connect(this.context.destination);
    source.onended = () => {
      // A pause, seek, tempo change or disposal may have superseded a queued event.
      if (this.source !== source) return;
      this.source = null;
      source.onended = null;
      source.disconnect();
      this.ended();
    };
    source.start();
    source.stop(Math.max(this.context.currentTime, when));
  }
  cancel() {
    const source = this.source;
    this.source = null;
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
  }
}

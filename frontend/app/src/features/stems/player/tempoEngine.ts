import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';
import processorUrl from 'signalsmith-stretch?url';
import { SongClock, validPitch, validTempo } from './tempo';
// Use the immutable hosted module, never generated JS or a third-party runtime URL.
SignalsmithStretch.moduleUrl = processorUrl;
export class TempoEngine {
  private clock: SongClock;
  private tempo = 1;
  private pitch = 0;
  private disposed = false;
  private failed = false;
  private running = false;
  private sources: AudioBufferSourceNode[] = [];
  private buffers: AudioBuffer[] = [];
  private destinations: AudioNode[] = [];
  private splitter: ChannelSplitterNode | null = null;
  private connected = false;
  private gates: GainNode[] = [];
  private routes: AudioNode[] = [];
  private context: BaseAudioContext;
  private node: StretchNode;
  private duration: number;
  private constructor(context: BaseAudioContext, node: StretchNode, duration: number) {
    this.context=context; this.node=node; this.duration=duration;
    this.clock = new SongClock(() => context.currentTime);
  }
  static async create(context: BaseAudioContext, buffers: AudioBuffer[], destinations: AudioNode[], fail: (message: string) => void) {
    if (!buffers.length || buffers.length !== destinations.length) throw new Error('Incomplete stem buffers.');
    const length = buffers[0].length;
    if (buffers.some(b => b.sampleRate !== context.sampleRate || b.length !== length)) throw new Error('Stem lengths or sample rates do not match.');
    const node = await SignalsmithStretch(context, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [buffers.length * 2], channelInterpretation: 'discrete' });
    const engine = new TempoEngine(context, node, buffers[0].duration);
    node.onprocessorerror = () => { engine.failed = true; engine.pause(); fail('Audio processing stopped. Reload the player to retry.'); };
    // One multichannel processor shares its time map across every stereo stem.
    const splitter = context.createChannelSplitter(buffers.length * 2);
    engine.splitter = splitter; engine.buffers=buffers; engine.destinations=destinations; engine.routes.push(splitter);
    destinations.forEach((destination, index) => {
      const merger = context.createChannelMerger(2), gate = context.createGain();
      splitter.connect(merger, index * 2, 0); splitter.connect(merger, index * 2 + 1, 1);
      gate.gain.value = 0; merger.connect(gate); gate.connect(destination);
      engine.gates.push(gate); engine.routes.push(merger, gate);
    });
    const channels = buffers.flatMap(buffer => [buffer.getChannelData(0).slice(), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice()]);
    try { await node.addBuffers(channels, channels.map(channel => channel.buffer)); }
    catch (error) { engine.dispose(); throw error; }
    return engine;
  }
  get position() { return Math.min(this.duration, this.clock.position); }
  private get neutral() { return this.tempo === 1 && this.pitch === 0; }
  private stopNative() { this.sources.forEach(source => { source.stop(); source.disconnect(); }); this.sources=[]; }
  private startNative(position: number, when: number) {
    this.sources = this.buffers.map((buffer,i) => { const source=this.context.createBufferSource(); source.buffer=buffer; source.connect(this.destinations[i]); source.start(when,position); return source; });
  }
  private connectProcessor() { if (!this.connected && this.splitter) { this.node.connect(this.splitter); this.connected=true; } }
  private gate(value: number, when: number) { this.gates.forEach(gate => { gate.gain.cancelScheduledValues(this.context.currentTime); gate.gain.setValueAtTime(value,when); }); }
  async start(position: number) {
    if (this.disposed || this.failed) throw new Error('Audio processor is unavailable. Reload the player.');
    this.stopNative();
    const when = this.context.currentTime + .02;
    this.clock.start(position, this.tempo, when); this.running=true;
    if (this.neutral) { this.node.disconnect(); this.connected=false; this.startNative(position,when); return; }
    this.connectProcessor(); this.gate(0,this.context.currentTime);this.gate(1,when);
    await this.node.schedule({ output: when, input: position, rate: this.tempo, semitones: this.pitch, active: true });
  }
  set(tempo: number, pitch: number) {
    if (!validTempo(tempo) || !validPitch(pitch)) throw new Error('Invalid tempo or pitch.');
    if (tempo === this.tempo && pitch === this.pitch) return;
    const wasNeutral=this.neutral, position=this.clock.position;
    this.clock.changeRate(tempo); this.tempo=tempo; this.pitch=pitch;
    if (!this.running) return;
    if (this.neutral) {
      void this.node.schedule({ active:false }); this.gate(0,this.context.currentTime);
      this.node.disconnect();this.connected=false;this.startNative(position,this.context.currentTime);
    } else {
      if (wasNeutral) this.stopNative();
      this.connectProcessor();this.gate(1,this.context.currentTime);
      void this.node.schedule({ output:this.context.currentTime,input:position,rate:tempo,semitones:pitch,active:true });
    }
  }
  pause() {
    const position=this.clock.pause();this.running=false;this.stopNative();
    if (!this.disposed) { void this.node.schedule({ active:false,output:this.context.currentTime });this.gate(0,this.context.currentTime);this.node.disconnect();this.connected=false; }
    return Math.min(this.duration,position);
  }

  dispose() { if (this.disposed) return; this.pause(); this.disposed = true; void this.node.dropBuffers(); this.node.disconnect(); this.routes.forEach(node => node.disconnect()); this.node.port.close(); }
}

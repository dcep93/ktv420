declare module 'signalsmith-stretch' {
  export type StretchSchedule = { output?: number; input?: number; active?: boolean; rate?: number; semitones?: number };
  export interface StretchNode extends AudioWorkletNode {
    schedule(value: StretchSchedule): Promise<unknown>;
    addBuffers(channels: Float32Array[], transfer?: ArrayBuffer[]): Promise<number>;
    dropBuffers(): Promise<unknown>;
    latency(): Promise<number>;
  }
  const create: ((context: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>) & { moduleUrl: string };
  export default create;
}

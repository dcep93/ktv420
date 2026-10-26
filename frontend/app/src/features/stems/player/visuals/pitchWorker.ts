import { analyzePitchChunk } from './pitchTimeline';
import type { PitchChunkInput, PitchSamples } from './pitchTimeline';
export type PitchRequest = PitchChunkInput & { id: string };
export type PitchResponse = { id: string; first: number } & ({ samples: PitchSamples } | { error: string });
self.onmessage=({data}:MessageEvent<PitchRequest>)=>{
  try {
    const samples=analyzePitchChunk(data);
    self.postMessage({id:data.id,first:data.first,samples}, {transfer:[samples.pitches.buffer,samples.levels.buffer,samples.hues.buffer]});
  } catch(reason) {
    self.postMessage({id:data.id,first:data.first,error:String(reason)});
  }
};

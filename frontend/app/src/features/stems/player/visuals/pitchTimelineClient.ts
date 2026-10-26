import { PITCH_CHUNK_SECONDS, PITCH_MARGIN_SECONDS, PITCH_STEP } from './pitchTimeline';
import type { PitchTimeline } from './pitchTimeline';
import type { PitchRequest, PitchResponse } from './pitchWorker';
import { FUTURE_WINDOW_SECONDS, PAST_WINDOW_SECONDS } from '../types';

type AudioSource = Pick<AudioBuffer,'length'|'sampleRate'|'numberOfChannels'|'getChannelData'>;
type Entry = { buffer: AudioSource; timeline: PitchTimeline; chunks: Uint8Array };
type WorkerPort = Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
export const createPitchWorker=()=>new Worker(new URL('./pitchWorker.ts',import.meta.url),{type:'module'});

/** One bounded in-flight copy. Playback buffers are never transferred or detached. */
export class PitchTimelineClient {
  private entries=new Map<string,Entry>();
  private worker:WorkerPort|null=null;
  private active:{id:string;chunk:number}|null=null;
  private disposed=false;
  private time=0;
  private cursor=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private onChange:()=>void;
  private makeWorker:()=>WorkerPort;
  constructor(onChange:()=>void,makeWorker:()=>WorkerPort=createPitchWorker) {
    this.onChange=onChange;this.makeWorker=makeWorker;
  }
  get(id:string){return this.entries.get(id)?.timeline;}
  add(id:string,buffer:AudioSource) {
    if(this.disposed||this.entries.has(id))return;
    const count=Math.ceil(buffer.length/buffer.sampleRate/PITCH_STEP);
    this.entries.set(id,{buffer,chunks:new Uint8Array(Math.ceil(count*PITCH_STEP/PITCH_CHUNK_SECONDS)),timeline:{
      pitches:new Float32Array(count).fill(NaN),levels:new Float32Array(count),hues:new Float32Array(count),
      ready:new Uint8Array(count),revision:0,failed:false,
    }});
    this.schedule();
  }
  setTime(time:number){if(Number.isFinite(time))this.time=Math.max(0,time);}
  private schedule(){
    if(this.disposed||this.active||this.timer!==undefined)return;
    this.timer=setTimeout(()=>{this.timer=undefined;this.next();},0);
  }
  private next(){
    if(this.disposed||this.active)return;
    const entries=[...this.entries];
    let selected:{id:string;entry:Entry;chunk:number}|undefined;
    // Visible chunks for every stem first, then complete the rest round-robin.
    for(const visibleOnly of [true,false]) {
      for(let offset=0;offset<entries.length;offset++) {
        const position=(this.cursor+offset)%entries.length,[id,entry]=entries[position];
        if(entry.timeline.failed)continue;
        let chunk=-1;
        if(visibleOnly) {
          const lo=Math.max(0,Math.floor((this.time-PAST_WINDOW_SECONDS)/PITCH_CHUNK_SECONDS));
          const hi=Math.min(entry.chunks.length-1,Math.floor((this.time+FUTURE_WINDOW_SECONDS)/PITCH_CHUNK_SECONDS));
          for(let i=lo;i<=hi;i++)if(!entry.chunks[i]){chunk=i;break;}
        } else chunk=entry.chunks.indexOf(0);
        if(chunk>=0){selected={id,entry,chunk};this.cursor=(position+1)%entries.length;break;}
      }
      if(selected)break;
    }
    if(!selected)return;
    const {id,entry,chunk}=selected;
    try {
      if(!this.worker) {
        this.worker=this.makeWorker();
        this.worker.onmessage=event=>this.receive(event.data as PitchResponse);
        this.worker.onerror=()=>this.failWorker();
        this.worker.onmessageerror=()=>this.failWorker();
      }
      const {buffer}=entry,first=Math.round(chunk*PITCH_CHUNK_SECONDS/PITCH_STEP);
      const count=Math.min(Math.round(PITCH_CHUNK_SECONDS/PITCH_STEP),entry.timeline.pitches.length-first);
      const startFrame=Math.max(0,Math.floor((first*PITCH_STEP-PITCH_MARGIN_SECONDS)*buffer.sampleRate));
      const endFrame=Math.min(buffer.length,Math.ceil(((first+count)*PITCH_STEP+PITCH_MARGIN_SECONDS)*buffer.sampleRate));
      const channels=Array.from({length:buffer.numberOfChannels},(_,channel)=>buffer.getChannelData(channel).slice(startFrame,endFrame));
      const request:PitchRequest={id,first,count,startFrame,sampleRate:buffer.sampleRate,channels};
      this.active={id,chunk};
      this.worker.postMessage(request,channels.map(channel=>channel.buffer));
    } catch {this.failWorker();}
  }
  private receive(data:PitchResponse){
    if(this.disposed||!this.active||data.id!==this.active.id)return;
    const entry=this.entries.get(data.id)!,chunk=this.active.chunk;
    const first=Math.round(chunk*PITCH_CHUNK_SECONDS/PITCH_STEP);
    if(data.first!==first)return;
    if('error' in data)entry.timeline.failed=true;
    else {
      const count=Math.min(Math.round(PITCH_CHUNK_SECONDS/PITCH_STEP),entry.timeline.pitches.length-first);
      if(data.samples.pitches.length!==count||data.samples.levels.length!==count||data.samples.hues.length!==count){this.failWorker();return;}
      entry.timeline.pitches.set(data.samples.pitches,first);
      entry.timeline.levels.set(data.samples.levels,first);
      entry.timeline.hues.set(data.samples.hues,first);
      entry.timeline.ready.fill(1,first,first+count);entry.chunks[chunk]=1;
    }
    entry.timeline.revision++;this.active=null;this.onChange();this.schedule();
  }
  private failWorker(){
    this.worker?.terminate();this.worker=null;this.active=null;
    for(const entry of this.entries.values()){entry.timeline.failed=true;entry.timeline.revision++;}
    this.onChange();
  }
  dispose(){
    this.disposed=true;clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.active=null;this.entries.clear();
  }
}

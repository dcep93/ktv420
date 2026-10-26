import { TempoEngine } from '../../stems/player/tempoEngine';
import { applyAudioEffect, createEffectNodes, prepareAudioEffects, syncAudioEffects, type AudioEffectType } from '../../stems/player/audioEffects';
import { connectStemEffects, disposeStemEffects } from '../../stems/player/stemGraph';
import { getLogarithmicVolumeGain } from '../../stems/player/mixerGain';
import type { PlaybackRecord } from '../../stems/player/types';
import type { MixerSnapshot, PerformanceEvent } from '../recording';
import { EXPORT_RATE, eventQuanta, checkExportMemory, type ExportSection } from './timeline';

export type RenderSource = { record: PlaybackRecord; offset: number; duration: number };
export async function renderSection(section: ExportSection, source: RenderSource, signal: AbortSignal, progress: (frames:number)=>void) {
  signal.throwIfAborted();
  const snapshot = section.events[0].snapshot!;
  checkExportMemory(source.duration,snapshot.stems.length,section.frames);
  const context = new OfflineAudioContext(2,section.frames,EXPORT_RATE);
  const files = snapshot.stems.map(stem => source.record.files.find(file => file.name===stem.name && file.path.includes('/input/')===stem.input));
  if (files.some(file=>!file)) throw new Error('This recording needs stems that are missing from this computer.');
  const buffers: AudioBuffer[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const buffer = await context.decodeAudioData(await file!.blob.arrayBuffer());
    signal.throwIfAborted();
    if (buffer.numberOfChannels>2 || Math.abs(buffer.duration-source.duration)>.1) throw new Error('Saved audio has a different duration. Capture this song again before exporting.');
    const gain = source.record.playbackGain ?? 1;
    if (!Number.isFinite(gain) || gain<=0) throw new Error('Invalid saved audio gain.');
    if(gain!==1) for(let c=0;c<buffer.numberOfChannels;c++) {
      const samples=buffer.getChannelData(c);for(let i=0;i<samples.length;i++) samples[i]/=gain;
    }
    buffers.push(buffer);
  }
  await prepareAudioEffects(context);
  const stems = buffers.map(()=>{
    const input=context.createGain(),effects=createEffectNodes(context);
    connectStemEffects(input,effects,context.destination);return {input,effects};
  });
  let engine: TempoEngine | undefined, playing=false, position=0,tempo=1;
  const apply = (value: MixerSnapshot, initial=false) => {
    if(value.stems.length!==snapshot.stems.length) throw new Error('Recording stem layout changed unexpectedly.');
    const solo=value.stems.some(stem=>stem.deafen);
    snapshot.stems.forEach((identity,i)=>{
      const valueStem=value.stems.find(stem=>stem.name===identity.name && stem.input===identity.input);
      if(!valueStem) throw new Error('Recording stem layout changed unexpectedly.');
      const gain=valueStem.mute || (solo && !valueStem.deafen) ? 0 : getLogarithmicVolumeGain(valueStem.volume);
      if(initial) stems[i].input.gain.setValueAtTime(gain,context.currentTime);
      else stems[i].input.gain.setTargetAtTime(gain,context.currentTime,.01);
      applyAudioEffect({context,nodes:stems[i].effects,effect:valueStem.effect as AudioEffectType,value:valueStem.value,settings:valueStem.effectSettings,tempo:value.tempo ?? 1});
    });
    const current=engine!.position;
    tempo=value.tempo ?? 1;
    stems.forEach(stem=>syncAudioEffects(stem.effects,current,playing?tempo:0,context.currentTime));
    return engine!.set(tempo,value.pitch ?? 0);
  };
  const act = async (event: PerformanceEvent) => {
    signal.throwIfAborted();
    if (event.type==='mix') { await apply(event.snapshot!); return; }
    if (event.type==='track') { position=Math.max(0,event.position-source.offset); await apply(event.snapshot!,true); return; }
    if (event.type==='pause' || event.type==='stop') {position=engine!.pause();playing=false;stems.forEach(stem=>syncAudioEffects(stem.effects,position,0,context.currentTime));return;}
    if (event.type==='play' || event.type==='seek') {
      engine!.pause();position=Math.max(0,event.position-source.offset);
      if (position>buffers[0].duration+.1) throw new Error('Recorded position is outside the saved audio.');
      if(event.type==='play') playing=true;
      stems.forEach(stem=>syncAudioEffects(stem.effects,position,playing?tempo:0,context.currentTime+(playing?.02:0)));
      if(playing) await engine!.start(Math.min(position,buffers[0].duration));
    }
  };
  let rendering: Promise<AudioBuffer> | undefined;
  let rejectProcessor!: (error: Error) => void;
  const processorFailed = new Promise<never>((_, reject) => { rejectProcessor = reject; });
  // A worklet failure is asynchronous: reject the export rather than throwing
  // out of its event handler or leaving a pending processor command unresolved.
  void processorFailed.catch(() => {});
  const perform = (event: PerformanceEvent) => Promise.race([act(event), processorFailed]);
  try {
    engine = await TempoEngine.create(context,buffers,stems.map(stem=>stem.input),message=>rejectProcessor(new Error(message)));
    stems.forEach(stem=>{stem.effects.node.onprocessorerror=()=>rejectProcessor(new Error('Audio effects stopped during export.'));});
    signal.throwIfAborted();
    const groups=eventQuanta(section);
    const initial=groups[0]?.[0]===0 ? groups.shift()![1] : [];
    for(const event of initial) await perform(event);
    // Queue every suspension before rendering; Chrome rejects suspending twice in one quantum.
    const pauses=groups.map(([frame,events])=>({frame,events,promise:context.suspend(frame/EXPORT_RATE)}));
    rendering=context.startRendering();
    // Observe rejection immediately, even while awaiting a scheduled suspension.
    const failed=rendering.then(()=>new Promise<never>(()=>{}));
    for(const pause of pauses) {
      await Promise.race([pause.promise,failed,processorFailed]); signal.throwIfAborted();
      for(const event of pause.events) await perform(event);
      progress(pause.frame); await context.resume();
    }
    const output=await Promise.race([rendering,processorFailed]);signal.throwIfAborted();progress(section.frames);return output;
  } finally {
    engine?.dispose();stems.forEach(stem=>disposeStemEffects(stem.input,stem.effects));
    if(context.state==='suspended' && rendering) {
      // Offline contexts cannot be closed. Resume any remaining scheduled suspensions
      // with a disconnected graph so a cancelled render can release its buffers.
      context.onstatechange=()=>{if(context.state==='suspended') void context.resume();};
      void context.resume();
    }
    if(rendering) void rendering.catch(()=>{});
  }
}

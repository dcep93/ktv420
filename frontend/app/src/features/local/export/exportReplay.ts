import { getPlaybackRecord, listTracks, withProcessingLock } from '../libraryClient';
import { captureStartSeconds } from '../listeningProtocol';
import type { PerformanceRecording } from '../recording';
import { compileExport, exportGain, checkExportMemory } from './timeline';
import { renderSection } from './render';
import { encodeInWorker } from './encodeClient';
export type ExportProgress = { fraction:number;phase:'rendering'|'encoding';secondsRemaining?:number };

const defaultStorage={listTracks,getPlaybackRecord,withProcessingLock};
export async function exportReplay(recording: PerformanceRecording, signal: AbortSignal, update: (progress:ExportProgress)=>void, storage=defaultStorage): Promise<Blob> {
  const timeline=compileExport(recording);
  const tracks=await storage.listTracks();signal.throwIfAborted();
  for(const required of recording.tracks) {
    const track=tracks.find(track=>track.id===`spotify-${required.id}`);
    if(!track || track.status!=='ready') throw new Error(`Prepare “${required.title}” before exporting.`);
    if(Math.abs(track.frames/track.sampleRate+captureStartSeconds(track.metadata)-required.duration)>=1) throw new Error(`Capture “${required.title}” again: its saved duration does not match.`);
  }
  for(const section of timeline.sections) {
    const track=tracks.find(track=>track.id===`spotify-${section.trackId}`)!;
    checkExportMemory(track.frames/track.sampleRate,section.events[0].snapshot!.stems.length,section.frames);
  }
  // Also exclude separation in another player tab through the existing broker lock.
  return storage.withProcessingLock(async acquired=>{
    if(!acquired) throw new Error('Wait for separation to finish before exporting.');
    return navigator.locks.request('ktv420-mp3-export',{ifAvailable:true},async lock=>{
    if(!lock) throw new Error('An MP3 export is already running in another tab.');
    signal.throwIfAborted();
    const root=await navigator.storage.getDirectory();
    const dir=await root.getDirectoryHandle('ktv420-export',{create:true});
    // Exclusive lock means any previous scratch file was abandoned, not another job's data.
    await dir.removeEntry('mix.pcm').catch((error:DOMException)=>{if(error.name!=='NotFoundError') throw error;});
    const estimate=await navigator.storage.estimate();
    const requiredBytes=timeline.frames*8*1.05+8*1024**2;
    if(estimate.quota!==undefined && requiredBytes>estimate.quota-(estimate.usage ?? 0)) throw new Error('Not enough local space to export this recording. Free some space and try again.');
    const handle=await dir.getFileHandle('mix.pcm',{create:true});
    let writer: FileSystemWritableFileStream | undefined;
    const started=performance.now();let completed=0,peak=0;
    const notify=(phase:ExportProgress['phase'],fraction:number)=>{
      const elapsed=(performance.now()-started)/1000;
      update({phase,fraction,secondsRemaining:elapsed>3 && fraction>.03 ? Math.max(0,elapsed/fraction-elapsed) : undefined});
    };
    try {
      writer=await handle.createWritable();notify('rendering',0);
      for(const section of timeline.sections) {
        signal.throwIfAborted();
        const track=tracks.find(track=>track.id===`spotify-${section.trackId}`)!;
        const record=await storage.getPlaybackRecord(track.id);signal.throwIfAborted();
        const output=await renderSection(section,{record,offset:captureStartSeconds(track.metadata),duration:track.frames/track.sampleRate},signal,
          frames=>notify('rendering',.8*(completed+frames)/timeline.frames));
        for(let start=0;start<output.length;start+=65536) {
          signal.throwIfAborted();const end=Math.min(output.length,start+65536);
          const interleaved=new Float32Array((end-start)*2),left=output.getChannelData(0),right=output.getChannelData(1);
          for(let i=start;i<end;i++) {
            if(!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('Export contains invalid audio.');
            peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
            interleaved[(i-start)*2]=left[i];interleaved[(i-start)*2+1]=right[i];
          }
          await writer.write(interleaved);
        }
        completed+=section.frames;
      }
      await writer.close();writer=undefined;signal.throwIfAborted();notify('encoding',.8);
      const result=await encodeInWorker(await handle.getFile(),timeline.frames,exportGain(peak),signal,fraction=>notify('encoding',.8+.2*fraction));
      signal.throwIfAborted();return result;
    } finally {
      if(writer) await writer.abort().catch(()=>{});
      await dir.removeEntry('mix.pcm').catch(()=>{});
    }
  }); });
}
export function exportFilename(name:string) {return `${Array.from(name,character=>character.charCodeAt(0)<32 ? '-' : character).join('').replace(/[<>:"/\\|?*]/g,'-').replace(/[. ]+$/,'').slice(0,150) || 'ktv420-mix'}.mp3`;}

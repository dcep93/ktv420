import { useEffect, useRef, useState } from 'react';
import type { PerformanceRecording } from '../recording';
import { downloadBlob } from '../importAudio';
import { exportReplay, exportFilename, type ExportProgress } from './exportReplay';
export function useReplayExport() {
  const controller=useRef<AbortController|null>(null);
  const [progress,setProgress]=useState<ExportProgress|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>()=>controller.current?.abort(),[]);
  const cancel=()=>controller.current?.abort();
  async function start(recording:PerformanceRecording) {
    if(controller.current) return;
    const next=new AbortController();controller.current=next;setError('');setProgress({phase:'rendering',fraction:0});
    try {
      const blob=await exportReplay(recording,next.signal,setProgress);next.signal.throwIfAborted();
      downloadBlob(blob,exportFilename(recording.name));
    } catch(reason) {
      if(!next.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {if(controller.current===next) {controller.current=null;setProgress(null);}}
  }
  return {start,cancel,progress,error,busy:progress!==null,controller};
}

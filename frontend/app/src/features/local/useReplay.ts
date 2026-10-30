import { useEffect, useRef, useState } from 'react';
import { PerformanceClock, type MixerControl, type PerformanceRecording } from './recording';
type Options = {
  recording: PerformanceRecording | null;
  select: (id: string) => void; control: () => MixerControl | null; offset: (id: string) => number;
};
type Run = { clock: PerformanceClock; cursor: number; track: string; cancelled: boolean; busy: boolean; audio: boolean; paused: boolean; recording: PerformanceRecording };
export function useReplay(options: Options) {
  const latest = useRef(options); latest.current = options;
  const run = useRef<Run | null>(null);
  const [status,setStatus] = useState<'idle'|'preparing'|'playing'|'paused'|'complete'>('idle');
  const [error,setError] = useState('');
  const [seconds,setSeconds] = useState(0);
  function stop(complete = false) {
    const current = run.current;
    if (current) { current.cancelled=true; current.clock.pause(); }
    run.current=null; latest.current.control()?.pause();
    setStatus(complete ? 'complete' : 'idle');
  }
  async function wait(current: Run, condition: () => boolean, message: string, timeout=12000) {
    const deadline = performance.now()+timeout;
    while (!condition()) {
      if (current.cancelled) throw new Error('Replay stopped.');
      if (performance.now()>deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve,40));
    }
    if (current.cancelled) throw new Error('Replay stopped.');
  }
  function checkRunning(current: Run) {
    if (current.cancelled) throw new Error('Replay stopped.');
  }
  async function applySnapshot(current: Run, snapshot: import('./recording').MixerSnapshot) {
    checkRunning(current);
    latest.current.control()?.apply(snapshot);
  }
  const actions = useRef({ stop, wait }); actions.current={stop,wait};
  async function tick() {
    const current=run.current;
    if (!current || current.busy || current.paused) return;
    current.busy=true;
    try {
      while (!current.cancelled && current.cursor<current.recording.events.length && current.recording.events[current.cursor].at<=current.clock.seconds) {
        const event=current.recording.events[current.cursor++];
        if (event.type==='mix') await applySnapshot(current,event.snapshot!);
        else {
          current.clock.pause();
          const controller=() => latest.current.control();
          if (event.type==='track') {
            controller()?.pause();current.audio=false;current.track=event.trackId;setStatus('preparing');
            latest.current.select(event.trackId);
            await actions.current.wait(current,() => controller()?.trackId===`spotify-${event.trackId}` && controller()?.ready===true,'Could not load the required stems.',30000);
            await applySnapshot(current,event.snapshot!);
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current); setStatus('playing');
          } else if (event.type==='play') {
            // The recorded song position is authoritative for the audible performance.
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current);
            await controller()!.play(); checkRunning(current); current.audio=true;
          } else if (event.type==='pause') {
            controller()?.pause();current.audio=false;
          } else if (event.type==='seek') {
            controller()?.pause();
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current);
            if (current.audio) await controller()!.play();
          } else { actions.current.stop(true); return; }
          if (!current.cancelled && !current.paused) current.clock.start();
        }
      }
      setSeconds(current.clock.seconds);
    } catch(e) {
      if (!current.cancelled) { actions.current.stop(); setError(e instanceof Error ? e.message : String(e)); }
    } finally { current.busy=false; }
  }
  const tickRef=useRef(tick);tickRef.current=tick;
  useEffect(() => { const timer=setInterval(() => void tickRef.current(),20); return () => { clearInterval(timer); if(run.current) run.current.cancelled=true; }; },[]);
  function start() {
    if (!options.recording) return;
    if(run.current) stop();
    setError('');setSeconds(0);setStatus('preparing');
    run.current={clock:new PerformanceClock(),cursor:0,track:'',cancelled:false,busy:false,audio:false,paused:false,recording:options.recording};
    run.current.clock.start();void tickRef.current();
  }
  async function togglePause() {
    const current=run.current;
    if (!current || current.busy) return;
    current.paused=!current.paused;
    if(current.paused) {
      current.busy=true;current.clock.pause();latest.current.control()?.pause();setStatus('paused');
      current.busy=false;
    }
    else {
      current.busy=true;
      try {
        if(current.audio) {
          await latest.current.control()?.play();
        }
        checkRunning(current); current.clock.start();setStatus('playing');
      } catch(e) { if (!current.cancelled) { stop();setError(e instanceof Error ? e.message : String(e)); } }
      finally { current.busy=false; }
    }
  }
  return {status,error,seconds,busy:run.current?.busy===true,start,stop:() => stop(),togglePause,active:status==='preparing'||status==='playing'||status==='paused'};
}

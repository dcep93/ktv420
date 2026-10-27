import { bestEffortSpotify, SpotifyRemoteObserver } from './spotifySync';
import { useEffect, useRef, useState } from 'react';
import { PerformanceClock, type MixerControl, type PerformanceRecording } from './recording';
import type { ListeningState, TransportCommand } from './listeningProtocol';
type Options = {
  recording: PerformanceRecording | null; listening: ListeningState | null;
  select: (id: string) => void; control: () => MixerControl | null; offset: (id: string) => number;
  transport: (command: TransportCommand) => void;
};
type Run = { clock: PerformanceClock; cursor: number; track: string; cancelled: boolean; busy: boolean; audio: boolean; paused: boolean; recording: PerformanceRecording };
export function useReplay(options: Options) {
  const latest = useRef(options); latest.current = options;
  const run = useRef<Run | null>(null);
  const remote = useRef(new SpotifyRemoteObserver());
  const [status,setStatus] = useState<'idle'|'preparing'|'playing'|'paused'|'complete'>('idle');
  const [error,setError] = useState('');
  const [seconds,setSeconds] = useState(0);
  function stop(complete = false) {
    const current = run.current;
    if (current) { current.cancelled=true; current.clock.pause(); }
    run.current=null; latest.current.control()?.pause(); bestEffortSpotify(latest.current.transport,{action:'pause'});
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
  function command(current: Run, value: TransportCommand) {
    checkRunning(current);
    remote.current.commanded();
    bestEffortSpotify(latest.current.transport,value);
  }
  async function applySnapshot(current: Run, snapshot: import('./recording').MixerSnapshot) {
    checkRunning(current);
    latest.current.control()?.apply(snapshot);
  }
  const actions = useRef({ stop, wait, command }); actions.current={stop,wait,command};
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
            await actions.current.command(current,{action:'select',trackId:event.trackId});
            await actions.current.command(current,{action:'pause'});
            await actions.current.command(current,{action:'seek',trackId:event.trackId,position:event.position});
            await applySnapshot(current,event.snapshot!);
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current); setStatus('playing');
          } else if (event.type==='play') {
            await actions.current.command(current,{action:'play'});
            // The recorded song position is authoritative for the audible performance.
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current);
            await controller()!.play(); checkRunning(current); current.audio=true;
          } else if (event.type==='pause') {
            controller()?.pause();current.audio=false;
            await actions.current.command(current,{action:'pause'});
          } else if (event.type==='seek') {
            controller()?.pause();
            await actions.current.command(current,{action:'seek',trackId:event.trackId,position:event.position});
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
    remote.current.commanded();
    if ((options.listening?.volume ?? 0)===0) bestEffortSpotify(options.transport,{action:'volume',volume:.7});
    run.current.clock.start();void tickRef.current();
  }
  async function togglePause() {
    const current=run.current;
    if (!current || current.busy) return;
    current.paused=!current.paused;
    if(current.paused) {
      current.busy=true;current.clock.pause();latest.current.control()?.pause();setStatus('paused');
      try { await command(current,{action:'pause'}); }
      catch(e) { if (!current.cancelled) { stop();setError(e instanceof Error ? e.message : String(e)); } }
      finally {current.busy=false;}
    }
    else {
      current.busy=true;
      try {
        if(current.audio) {
          await command(current,{action:'play'});
          await latest.current.control()?.play();
        }
        checkRunning(current); current.clock.start();setStatus('playing');
      } catch(e) { if (!current.cancelled) { stop();setError(e instanceof Error ? e.message : String(e)); } }
      finally { current.busy=false; }
    }
  }
  useEffect(() => {
    const current=run.current, state=options.listening;
    const change=remote.current.observe(state);
    if (!current || current.busy || !change || state?.trackId !== current.track) return;
    if (current.audio && !current.paused && change.playing === false) {
      current.paused=true;current.clock.pause();latest.current.control()?.pause();setStatus('paused');
    } else if(current.paused && change.playing === true) {
      current.busy=true;
      void latest.current.control()?.play().then(() => {
        if (current.cancelled) return;
        current.paused=false;current.clock.start();setStatus('playing');
      }).catch(reason => {
        if (!current.cancelled) { actions.current.stop();setError(String(reason)); }
      }).finally(() => {current.busy=false;});
    }
  },[options.listening]);
  return {status,error,seconds,busy:run.current?.busy===true,start,stop:() => stop(),togglePause,active:status==='preparing'||status==='playing'||status==='paused'};
}

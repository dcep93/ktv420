import { useEffect, useRef, useState } from 'react';
import { PerformanceClock, type MixerControl, type PerformanceRecording } from './recording';
import type { ListeningState, TransportCommand } from './listeningProtocol';
type Options = {
  recording: PerformanceRecording | null; listening: ListeningState | null;
  select: (id: string) => void; control: () => MixerControl | null; offset: (id: string) => number;
  transport: (command: TransportCommand) => void;
};
type Run = { clock: PerformanceClock; cursor: number; track: string; cancelled: boolean; busy: boolean; audio: boolean; paused: boolean; guard: number; recording: PerformanceRecording };
export function useReplay(options: Options) {
  const latest = useRef(options); latest.current = options;
  const run = useRef<Run | null>(null);
  const [status,setStatus] = useState<'idle'|'preparing'|'playing'|'paused'|'complete'>('idle');
  const [error,setError] = useState('');
  const [seconds,setSeconds] = useState(0);
  function stop(complete = false) {
    const current = run.current;
    if (current) { current.cancelled=true; current.clock.pause(); }
    run.current=null; latest.current.control()?.pause(); latest.current.transport({action:'pause'});
    setStatus(complete ? 'complete' : 'idle');
  }
  async function wait(current: Run, condition: () => boolean, message: string, timeout=12000) {
    const deadline = performance.now()+timeout;
    while (!condition()) {
      if (current.cancelled) throw new Error('Replay stopped.');
      if (performance.now()>deadline) throw new Error(message);
      const failure = latest.current.listening?.error;
      if (failure) throw new Error(failure);
      await new Promise(resolve => setTimeout(resolve,40));
    }
    if (current.cancelled) throw new Error('Replay stopped.');
  }
  function checkRunning(current: Run) {
    if (current.cancelled) throw new Error('Replay stopped.');
  }
  async function command(current: Run, value: TransportCommand, condition: () => boolean) {
    checkRunning(current);
    current.guard=Date.now()+1500; latest.current.transport(value);
    // Require a fresh observation so old playback state cannot acknowledge a new command.
    const observed = latest.current.listening?.observedAt || 0;
    await wait(current,() => (latest.current.listening?.observedAt || 0)>observed && condition(),'Spotify did not synchronize. Check that Spotify is playing on this computer.');
    current.guard=Date.now()+100;
  }
  async function applySnapshot(current: Run, snapshot: import('./recording').MixerSnapshot) {
    checkRunning(current);
    const rate = snapshot.tempo ?? 1;
    const changeRate=rate !== (latest.current.listening?.playbackRate ?? 1);
    if (changeRate && !latest.current.listening?.tempoSupported) throw new Error('Update ktv420 to 6.3 or later, then reload Spotify to replay tempo changes.');
    // Audible automation follows performance time; acknowledgment must not delay it.
    latest.current.control()?.apply(snapshot);
    if (changeRate) await command(current,{action:'rate',rate,trackId:current.track},() => latest.current.listening?.playbackRate===rate);
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
          const listening=() => latest.current.listening;
          if (event.type==='track') {
            controller()?.pause();current.audio=false;current.track=event.trackId;setStatus('preparing');
            latest.current.select(event.trackId);
            await actions.current.wait(current,() => controller()?.trackId===`spotify-${event.trackId}` && controller()?.ready===true,'Could not load the required stems.',30000);
            await actions.current.command(current,{action:'select',trackId:event.trackId},() => listening()?.trackId===event.trackId && listening()?.local===true);
            await actions.current.command(current,{action:'pause'},() => listening()?.playing===false);
            await actions.current.command(current,{action:'seek',trackId:event.trackId,position:event.position},() => Math.abs((listening()?.position ?? -10)-event.position)<.6);
            await applySnapshot(current,event.snapshot!);
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current); setStatus('playing');
          } else if (event.type==='play') {
            await actions.current.command(current,{action:'play'},() => listening()?.playing===true);
            // The recorded song position is authoritative for the audible performance.
            await controller()!.seek(Math.max(0,event.position-latest.current.offset(event.trackId)));
            checkRunning(current);
            await controller()!.play(); checkRunning(current); current.audio=true;
          } else if (event.type==='pause') {
            controller()?.pause();current.audio=false;
            await actions.current.command(current,{action:'pause'},() => listening()?.playing===false);
          } else if (event.type==='seek') {
            controller()?.pause();
            await actions.current.command(current,{action:'seek',trackId:event.trackId,position:event.position},() => Math.abs((listening()?.position ?? -10)-event.position)<.6);
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
    run.current={clock:new PerformanceClock(),cursor:0,track:'',cancelled:false,busy:false,audio:false,paused:false,guard:Date.now()+1500,recording:options.recording};
    if ((options.listening?.volume ?? 0)===0) options.transport({action:'volume',volume:.7});
    run.current.clock.start();void tickRef.current();
  }
  async function togglePause() {
    const current=run.current;
    if (!current || current.busy) return;
    current.paused=!current.paused;current.guard=Date.now()+1500;
    if(current.paused) {
      current.busy=true;current.clock.pause();latest.current.control()?.pause();setStatus('paused');
      try { await command(current,{action:'pause'},() => latest.current.listening?.playing===false); }
      catch(e) { if (!current.cancelled) { stop();setError(e instanceof Error ? e.message : String(e)); } }
      finally {current.busy=false;}
    }
    else {
      current.busy=true;
      try {
        if(current.audio) {
          await command(current,{action:'play'},() => latest.current.listening?.playing===true);
          await latest.current.control()?.play();
        }
        checkRunning(current); current.clock.start();setStatus('playing');
      } catch(e) { if (!current.cancelled) { stop();setError(e instanceof Error ? e.message : String(e)); } }
      finally { current.busy=false; }
    }
  }
  const toggleRef=useRef(togglePause);toggleRef.current=togglePause;
  useEffect(() => {
    const key=(event:KeyboardEvent) => {
      if(!run.current || event.code!=='Space' || event.repeat || event.altKey || event.metaKey || event.ctrlKey || event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('input,textarea,button,a,select,[contenteditable]'))) return;
      event.preventDefault();void toggleRef.current();
    };
    window.addEventListener('keydown',key);return () => window.removeEventListener('keydown',key);
  },[]);
  useEffect(() => {
    const current=run.current, state=options.listening;
    if (!current || current.busy || !state || Date.now()<current.guard) return;
    if (state.error || (current.audio && !current.paused && (!state.local || Date.now()-state.observedAt>1800))) {
      actions.current.stop();setError(state.error || 'Spotify disconnected. Press Play recording to restart.');return;
    }
    if (state.trackId && state.trackId!==current.track) {
      const next=current.recording.events.slice(current.cursor).find(event => event.type==='track');
      if (!(next?.trackId===state.trackId && next.at-current.clock.seconds<2)) { actions.current.stop();setError('Spotify changed songs. Replay stopped.');return; }
    }
    if (current.audio && !current.paused && state.playing && state.trackId===current.track && Math.abs(state.position + Math.max(0,Date.now()-state.observedAt)/1000*(state.playbackRate ?? 1)-(latest.current.control()?.position() || 0)-latest.current.offset(current.track))>1.5) { actions.current.stop();setError('Spotify moved to another position. Replay stopped; press Play recording to restart.');return; }
    if (current.audio && !current.paused && !state.playing) { current.paused=true;current.clock.pause();latest.current.control()?.pause();setStatus('paused'); }
    else if(current.paused && state.playing) { current.paused=false;void latest.current.control()?.play();current.clock.start();setStatus('playing'); }
  },[options.listening]);
  return {status,error,seconds,busy:run.current?.busy===true,start,stop:() => stop(),togglePause,active:status==='preparing'||status==='playing'||status==='paused'};
}

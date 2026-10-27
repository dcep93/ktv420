import { useCallback, useEffect, useRef, useState } from 'react';
import { HostedCaptureQueue } from './hostedCapture';
import type { useSpotifyOverlay } from './useSpotifyOverlay';
import type { LocalTrack } from './library';

type Options = { spotify: ReturnType<typeof useSpotifyOverlay>; tracks: LocalTrack[]; libraryReady:boolean; required: {id:string}[]; replaying:boolean; onError:(message:string)=>void };
export function useHostedCapture(options:Options) {
  const latest = useRef(options); latest.current = options;
  const queue = useRef(new HostedCaptureQueue());
  const [active,setActive] = useState(false);
  const [,render] = useState(0);
  const epoch = useRef(0);
  const autoAttempt = useRef('');
  const autoContinue = useRef('');
  const successful = useRef(new Set<string>());
  const supported = options.spotify.listening?.relayVersion === 1;
  const cancel = useCallback(() => {
    epoch.current++; autoContinue.current = ''; queue.current.cancel(); setActive(false); latest.current.spotify.cancelCapture();
  }, []);
  const run = useCallback(async (ids:string[], automatic=false, followCollection=false) => {
    const current = latest.current, token = ++epoch.current;
    current.onError('');
    try {
      const completed = await queue.current.run(followCollection ? () => latest.current.spotify.tracks.map(track => track.trackId) : ids, () => new Set([...successful.current,...latest.current.tracks.map(t=>t.id.replace(/^spotify-/,''))]), async id => {
        await latest.current.spotify.captureOne(id); successful.current.add(id);
      }, () => { setActive(queue.current.active); render(n=>n+1); });
      if (token === epoch.current && completed && automatic && latest.current.spotify.navigation?.open) {
        // Spotify may already have advanced before the primitive paused it.
        // Select the intended next row instead of issuing a second Next.
        const rows = latest.current.spotify.tracks;
        const index = rows.findIndex(row => row.trackId === ids[0]);
        const next = index >= 0 ? rows[index + 1]?.trackId : undefined;
        if (next) {
          autoContinue.current = next;
          latest.current.spotify.transport({action:'select',trackId:next,bestEffort:true});
        }
      }
    } catch(reason) { if (token === epoch.current) { queue.current.cancel(); latest.current.onError(reason instanceof Error ? reason.message : String(reason)); } }
    finally { if (token === epoch.current) setActive(queue.current.active); }
  }, []);
  const toggle = useCallback(() => {
    const {spotify,required} = latest.current;
    if (spotify.listening?.relayVersion !== 1) { spotify.toggleCapture(); return; }
    if (queue.current.active || spotify.active) { cancel(); return; }
    if (!spotify.tracksComplete) return;
    if (required.length) spotify.transport({action:'volume',volume:0});
    void run(required.length ? required.map(t=>t.id) : spotify.tracks.map(t=>t.trackId), false, !required.length);
  }, [cancel,run]);
  useEffect(() => {
    const state = options.spotify.listening;
    if (!supported || !options.spotify.tracksComplete || !options.libraryReady || !options.spotify.navigation?.open || options.replaying || options.spotify.replay || queue.current.active || options.spotify.active || !state?.playing || state.output !== 'muted' || !state.local || (!state.captureAllowed && autoContinue.current !== state.trackId) || state.syncing || state.error) return;
    if (options.tracks.some(t=>t.id===`spotify-${state.trackId}`) || successful.current.has(state.trackId)) return;
    if (autoAttempt.current === state.trackId) return;
    autoAttempt.current = state.trackId; autoContinue.current = '';
    void run([state.trackId],true);
  }, [options,supported,run]);
  useEffect(() => { for (const track of options.tracks) successful.current.delete(track.id.replace(/^spotify-/,'')); }, [options.tracks]);
  const progress = options.spotify.captureProgress?.fraction || 0;
  const fraction = active && queue.current.total ? Math.min(1,(queue.current.completed + progress)/queue.current.total) : null;
  const report = options.spotify.reportCaptureFraction;
  useEffect(() => { report(fraction); return () => report(null); }, [fraction,report]);
  const context = options.spotify.spotifyPath, open = options.spotify.navigation?.open;
  useEffect(() => { if (!open) cancel(); return cancel; }, [context,open,cancel]);
  return { active:supported ? active || options.spotify.active : options.spotify.active, toggle, cancel };
}

import { pendingCaptureSaves, acknowledgeCaptureSaves, type CaptureProgress } from './captureProgress';
import { parseOverlayNavigation, type OverlayNavigation } from './overlayNavigation';
import { parseRecording, spotifyContext, type PerformanceRecording } from './recording';
import { parseListeningState, type ListeningState, type TransportCommand } from './listeningProtocol';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { brokerOrigin } from './libraryClient';

export type SpotifyTrack = { trackId: string; trackName: string; trackArtist: string; trackArtworkSrc: string; rowIndex: number };
type SpotifyState = { navigation: OverlayNavigation | null; spotifyPath: string; listening: ListeningState | null; tracks: SpotifyTrack[]; active: boolean; starting: boolean; supported: boolean; notice: string; error: string; captureProgress: CaptureProgress | null; savingTrackIds: string[] };
const initial: SpotifyState = { navigation: null, spotifyPath: '', listening: null, tracks: [], active: false, starting: false, supported: false, notice: '', error: '', captureProgress: null, savingTrackIds: [] };
const embedded = window.parent !== window;
const standalone = new URLSearchParams(window.location.search).get('standalone') === '1';
// The extension broker authenticates Spotify and relays only overlay controls.
const parentOrigin = embedded ? brokerOrigin() : '';
function send(type: string, command?: TransportCommand) {
  if (standalone && !['ready', 'view-ready', 'close', 'view'].includes(type)) return;
  if (embedded) window.parent.postMessage({ source: 'ktv420-overlay', version: 2, type, command, ...(type === 'ready' ? { controller: 'hosted' } : {}) }, parentOrigin);
}
export function useSpotifyOverlay(onClose?: () => void) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  const [state, setState] = useState(initial);
  const hostedFraction = useRef<number | null>(null);
  const reportCaptureFraction = useCallback((fraction:number|null) => {hostedFraction.current=fraction;}, []);
  const captureRequest = useRef<{id:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>} | null>(null);
  const cancelCapture = useCallback(() => {
    const pending = captureRequest.current;
    if (!pending) return;
    captureRequest.current = null; clearTimeout(pending.timer);
    window.parent.postMessage({source:'ktv420-overlay',version:2,type:'capture-cancel',id:pending.id},parentOrigin);
    pending.reject(new Error('Capture stopped.'));
  }, []);
  const captureOne = useCallback((trackId:string) => new Promise<void>((resolve,reject) => {
    if (standalone) { reject(new Error('Capture is only available on Spotify.')); return; }
    if (captureRequest.current) { reject(new Error('Capture is busy.')); return; }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => cancelCapture(), 2 * 60 * 60 * 1000);
    captureRequest.current = {id,resolve,reject,timer};
    window.parent.postMessage({source:'ktv420-overlay',version:2,type:'capture-one',id,trackId},parentOrigin);
  }), [cancelCapture]);
  const [replay,setReplay] = useState<PerformanceRecording | null>(null);
  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.source === 'ktv420-broker' && event.data.type === 'hello') {
        if (event.data.version !== 2) setState(previous => ({ ...previous, error: 'Update the ktv420 extension to use this player.' }));
        else send('ready');
        return;
      }
      if (event.data?.source === 'ktv420-parent' && event.data.version === 2 && event.data.type === 'closed') {
        cancelCapture(); setState(previous => ({...previous,navigation:previous.navigation ? {...previous.navigation,open:false} : null})); closeRef.current?.(); return;
      }
      if (event.data?.source === 'ktv420-parent' && event.data.version === 2 && event.data.type === 'replay') {
        if(event.data.recording===null) {setReplay(null);return;}
        try { const next = parseRecording(event.data.recording); setReplay(previous => previous?.createdAt === next.createdAt && previous?.name === next.name ? previous : next); } catch { /* broker reports malformed recordings */ }
        return;
      }
      if (event.data?.source === 'ktv420-parent' && event.data.version === 2 && event.data.type === 'capture-result') {
        const pending = captureRequest.current;
        if (pending && event.data.id === pending.id) {
          captureRequest.current = null; clearTimeout(pending.timer);
          if (event.data.ok === true) pending.resolve(); else pending.reject(new Error(event.data.error || 'Capture failed.'));
        }
        return;
      }
      if (event.data?.source !== 'ktv420-parent' || event.data.type !== 'state' || event.data.version !== 2) return;
      const data = event.data;
      const tracks: SpotifyTrack[] = Array.isArray(data.tracks) ? data.tracks.slice(0, 10000)
        .filter((track: SpotifyTrack) => typeof track?.trackId === 'string' && /^[A-Za-z0-9]{1,100}$/.test(track.trackId) && typeof track.trackName === 'string')
        .map((track: SpotifyTrack, rowIndex: number) => ({ trackId: track.trackId, trackName: track.trackName.slice(0, 500),
          trackArtist: typeof track.trackArtist === 'string' ? track.trackArtist.slice(0, 500) : '',
          trackArtworkSrc: typeof track.trackArtworkSrc === 'string' && /^https:\/\/(?:i|mosaic)\.scdn\.co\//.test(track.trackArtworkSrc) ? track.trackArtworkSrc : '', rowIndex: Number.isSafeInteger(track.rowIndex) && track.rowIndex >= 0 ? track.rowIndex : rowIndex })) : [];
      const capture = data.captureProgress;
      const captureProgress: CaptureProgress | null = data.active === true && capture && typeof capture.trackId === 'string' && /^[A-Za-z0-9]{1,100}$/.test(capture.trackId) &&
        (capture.fraction === null || (typeof capture.fraction === 'number' && Number.isFinite(capture.fraction) && capture.fraction >= 0 && capture.fraction <= 1))
        ? { trackId: capture.trackId, fraction: capture.fraction, ...(capture.phase === 'saving' ? { phase: 'saving' as const } : {}) } : null;
      setState(previous => ({ navigation: parseOverlayNavigation(data.navigation), spotifyPath: spotifyContext(data.spotifyPath) ? data.spotifyPath : '', listening: parseListeningState(data.listening), tracks, active: data.active === true, starting: data.starting === true, supported: data.supported === true, captureProgress,
        notice: typeof data.notice === 'string' ? data.notice : '', error: typeof data.error === 'string' ? data.error : '',
        savingTrackIds: pendingCaptureSaves(previous.savingTrackIds, captureProgress, data.error),
      }));
    };
    window.addEventListener('message', receive); send('ready');
    const heartbeat = setInterval(() => { if (standalone) return; window.parent.postMessage({source:'ktv420-overlay',version:2,type:'listening-heartbeat',captureFraction:hostedFraction.current},parentOrigin); }, 500);
    send('listening-heartbeat');
    return () => { cancelCapture(); clearInterval(heartbeat); window.removeEventListener('message', receive); };
  }, [cancelCapture]);
  // A mounted iframe is not a rendered playlist. Acknowledge only after React
  // has committed actual rows for the requested Spotify context.
  useLayoutEffect(() => {
    if (!embedded || !state.supported || !state.tracks.length || !state.navigation?.open) return;
    window.parent.postMessage({ source: 'ktv420-overlay', version: 2, type: 'view-ready',
      spotifyPath: state.spotifyPath, revision: state.navigation.revision }, parentOrigin);
  }, [state]);
  const acknowledgeSaved = useCallback((ids: string[]) => {
    setState(previous => {
      const savingTrackIds = acknowledgeCaptureSaves(previous.savingTrackIds, ids);
      return savingTrackIds === previous.savingTrackIds ? previous : { ...previous, savingTrackIds };
    });
  }, []);
  return { ...state, reportCaptureFraction, captureOne, cancelCapture, acknowledgeSaved, replay, embedded, standalone, setView: sendView, transport: sendTransport, dismissReplay: () => send('dismiss-replay'), toggleCapture: () => send('toggle-capture'), close: () => send('close') };
}

const sendTransport = (command: TransportCommand) => send('transport', command);

function sendView(trackIndex: number | null, revision: number, replace = false) {
  if (embedded) window.parent.postMessage({ source: 'ktv420-overlay', version: 2, type: 'view', trackIndex, revision, replace }, parentOrigin);
}

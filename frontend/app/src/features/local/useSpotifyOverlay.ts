import { parseListeningState, type ListeningState, type TransportCommand } from './listeningProtocol';
import { useEffect, useState } from 'react';
import { brokerOrigin } from './libraryClient';

export type SpotifyTrack = { trackId: string; trackName: string; trackArtist: string; trackArtworkSrc: string; rowIndex: number };
type SpotifyState = { listening: ListeningState | null; tracks: SpotifyTrack[]; active: boolean; starting: boolean; supported: boolean; notice: string; error: string; captureProgress: { trackId: string; fraction: number | null } | null };
const initial: SpotifyState = { listening: null, tracks: [], active: false, starting: false, supported: false, notice: '', error: '', captureProgress: null };
const embedded = window.parent !== window;
// The extension broker authenticates Spotify and relays only overlay controls.
const parentOrigin = embedded ? brokerOrigin() : '';
function send(type: string, command?: TransportCommand) {
  if (embedded) window.parent.postMessage({ source: 'ktv420-overlay', version: 2, type, command }, parentOrigin);
}
export function useSpotifyOverlay() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.source === 'ktv420-broker' && event.data.type === 'hello') {
        if (event.data.version !== 2) setState(previous => ({ ...previous, error: 'Update the ktv420 extension to use this player.' }));
        else send('ready');
        return;
      }
      if (event.data?.source !== 'ktv420-parent' || event.data.type !== 'state' || event.data.version !== 2) return;
      const data = event.data;
      const tracks: SpotifyTrack[] = Array.isArray(data.tracks) ? data.tracks.slice(0, 10000)
        .filter((track: SpotifyTrack) => typeof track?.trackId === 'string' && /^[A-Za-z0-9]{1,100}$/.test(track.trackId) && typeof track.trackName === 'string')
        .map((track: SpotifyTrack, rowIndex: number) => ({ trackId: track.trackId, trackName: track.trackName.slice(0, 500),
          trackArtist: typeof track.trackArtist === 'string' ? track.trackArtist.slice(0, 500) : '',
          trackArtworkSrc: typeof track.trackArtworkSrc === 'string' && /^https:\/\/(?:i|mosaic)\.scdn\.co\//.test(track.trackArtworkSrc) ? track.trackArtworkSrc : '', rowIndex })) : [];
      const capture = data.captureProgress;
      const captureProgress = data.active === true && capture && typeof capture.trackId === 'string' && /^[A-Za-z0-9]{1,100}$/.test(capture.trackId) &&
        (capture.fraction === null || (typeof capture.fraction === 'number' && Number.isFinite(capture.fraction) && capture.fraction >= 0 && capture.fraction <= 1))
        ? { trackId: capture.trackId, fraction: capture.fraction } : null;
      setState({ listening: parseListeningState(data.listening), tracks, active: data.active === true, starting: data.starting === true, supported: data.supported === true, captureProgress,
        notice: typeof data.notice === 'string' ? data.notice : '', error: typeof data.error === 'string' ? data.error : '' });
    };
    window.addEventListener('message', receive); send('ready');
    const heartbeat = setInterval(() => send('listening-heartbeat'), 500);
    send('listening-heartbeat');
    return () => { clearInterval(heartbeat); window.removeEventListener('message', receive); };
  }, []);
  return { ...state, embedded, transport: sendTransport, toggleCapture: () => send('toggle-capture'), close: () => send('close') };
}

const sendTransport = (command: TransportCommand) => send('transport', command);

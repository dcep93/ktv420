import { useEffect, useState } from 'react';
import { brokerOrigin } from './libraryClient';

export type SpotifyTrack = { trackId: string; trackName: string; trackArtist: string; trackArtworkSrc: string; rowIndex: number };
type SpotifyState = { tracks: SpotifyTrack[]; active: boolean; starting: boolean; supported: boolean; notice: string; error: string };
const initial: SpotifyState = { tracks: [], active: false, starting: false, supported: false, notice: '', error: '' };
const embedded = window.parent !== window;
// The extension broker authenticates Spotify and relays only overlay controls.
const parentOrigin = embedded ? brokerOrigin() : '';
function send(type: string) {
  if (embedded) window.parent.postMessage({ source: 'ktv420-overlay', version: 2, type }, parentOrigin);
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
      setState({ tracks, active: data.active === true, starting: data.starting === true, supported: data.supported === true,
        notice: typeof data.notice === 'string' ? data.notice : '', error: typeof data.error === 'string' ? data.error : '' });
    };
    window.addEventListener('message', receive); send('ready');
    return () => window.removeEventListener('message', receive);
  }, []);
  return { ...state, embedded, toggleCapture: () => send('toggle-capture'), close: () => send('close') };
}

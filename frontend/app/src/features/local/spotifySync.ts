import type { TransportCommand } from './listeningProtocol';

export type RemotePlayback = {
  trackId?: string; position: number; playing: boolean; observedAt: number;
  local?: boolean; error?: string; syncing?: boolean; playbackRate?: number;
};
export type RemoteChange = { trackId?: string; playing?: boolean; position?: number };

/** Spotify is a remote control, not the clock for locally rendered audio. */
export class SpotifyRemoteObserver {
  private previous: RemotePlayback | null = null;
  private ignoreUntil = 0;
  commanded(now = Date.now()) { this.ignoreUntil = now + 3000; this.previous = null; }
  observe(state: RemotePlayback | undefined | null, now = Date.now()): RemoteChange | null {
    if (!state || state.local === false || state.error || now - state.observedAt > 1800 || state.syncing) {
      this.previous = null; return null;
    }
    const previous = this.previous;
    this.previous = state;
    if (now < this.ignoreUntil || !previous || state.observedAt <= previous.observedAt) return null;
    if (state.trackId !== previous.trackId) return { trackId: state.trackId, playing: state.playing, position: state.position };
    const expected = previous.position + (previous.playing ? (state.observedAt - previous.observedAt) / 1000 * (previous.playbackRate ?? 1) : 0);
    const seek = Math.abs(state.position - expected) > 1.5;
    if (!seek && state.playing === previous.playing) return null;
    return { ...(seek ? { position: state.position } : {}),
      ...(state.playing !== previous.playing ? { playing: state.playing } : {}) };
  }
}

export function bestEffortSpotify(send: (command: TransportCommand) => void, command: TransportCommand) {
  try { send({ ...command, bestEffort: true }); }
  catch (error) { console.debug('[ktv420] Spotify sync unavailable', error); }
}

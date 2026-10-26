import type { TransportCommand } from './listeningProtocol';

export type NativePlayback = { trackId?: string; position: number; duration?: number; playing: boolean; local?: boolean; observedAt: number; capturing?: boolean; syncing?: boolean; error?: string };
export type AudiblePlayback = { trackId: string; position: number; duration: number; playing: boolean };
/** Shared by the hosted drift loop and remote observers. Never suppress a pause or a track change. */
export class SeekEcho {
  private pending: { trackId: string; position: number; sent: number; until: number } | null = null;
  mark(trackId: string, position: number, now: number) { this.pending = { trackId, position, sent: now, until: now + 6000 }; }
  active(state: NativePlayback, now: number) { return !!this.pending && now <= this.pending.until && state.trackId === this.pending.trackId; }
  matches(state: NativePlayback, now: number) {
    if (!this.active(state, now)) return false;
    const p = this.pending!;
    return Math.abs(state.position - (p.position + (state.playing ? Math.max(0, state.observedAt - p.sent) / 1000 : 0))) < 2;
  }
  clear() { this.pending = null; }
}
export const spotifySeekEcho = new SeekEcho();

/** One in-flight correction, bounded retries, no dependency on successful Spotify control. */
export class SpotifyDriftController {
  private pending: { trackId: string; target: number; sent: number } | null = null;
  private nextAt = 0;
  private failures = 0;
  private trackId = '';
  private echo: SeekEcho;
  constructor(echo: SeekEcho = spotifySeekEcho) { this.echo = echo; }
  reset() { this.pending = null; this.nextAt = 0; this.failures = 0; this.trackId = ''; this.echo.clear(); }
  tick(native: NativePlayback | null, audio: AudiblePlayback | null, now: number): TransportCommand | null {
    if (!audio || !native || native.trackId !== audio.trackId || native.capturing || !native.local || native.error || now - native.observedAt > 1800) {
      this.reset(); return null;
    }
    if (!audio.playing || !native.playing) { this.pending = null; this.nextAt = now + 3000; return null; }
    if (this.trackId !== audio.trackId) { this.reset(); this.trackId = audio.trackId; }
    if (this.pending) {
      const p = this.pending;
      if (native.observedAt > p.sent && this.echo.matches(native, now)) {
        this.pending = null; this.failures = 0; this.nextAt = now + Math.min(3000, Math.max(250, ((native.duration || audio.duration) - native.position - 2) * 1000));
      } else if (now - p.sent >= 5000) {
        this.pending = null; this.failures++; this.nextAt = now + Math.min(60000, 5000 * 2 ** this.failures);
      }
      return null;
    }
    if (native.syncing || now < this.nextAt) return null;
    const drift = native.position - audio.position;
    const remaining = (native.duration || audio.duration) - native.position;
    // Near the ending, a smaller lead can still cut off the audible tail.
    const endangered = remaining < 8 && drift > .25 && audio.duration - audio.position > .1;
    if (Math.abs(drift) < 5 && !endangered) return null;
    // Keep a guard band at the ending; seeking exactly to a nearly finished
    // audible position would let native 1× playback overtake it before the next correction.
    const position = Math.max(0, Math.min(audio.position, (native.duration || audio.duration) - (endangered ? 8 : .5)));
    this.pending = { trackId: audio.trackId, target: position, sent: now };
    this.echo.mark(audio.trackId, position, now);
    return { action: 'seek', trackId: audio.trackId, position, bestEffort: true, correction: true };
  }
}

import { validEffectSettings, type EffectSettings } from '../stems/player/effects/catalog';
import { validTempo, validPitch } from '../stems/player/tempo';
/** Portable performances contain instructions only. Times use seconds, never wall-clock dates. */
export const MAX_RECORDING_BYTES = 4 * 1024 * 1024;
export type MixerSnapshot = {
  tempo?: number; pitch?: number;
  visualizer: string;
  stems: { name: string; input: boolean; volume: number; mute: boolean; deafen: boolean; effect: string; value: number; effectSettings?: EffectSettings }[];
  spotlight: { intent: { kind: 'input' | 'output'; name?: string }; level: 'track' | 'track-with-selectors' } | null;
};
export type PerformanceEvent = {
  at: number; type: 'track' | 'mix' | 'play' | 'pause' | 'seek' | 'stop'; trackId: string; position: number; snapshot?: MixerSnapshot;
};
export type PerformanceRecording = {
  version: 2 | 3; name: string; createdAt: string; spotifyPath: string;
  tracks: { id: string; title: string; duration: number }[]; events: PerformanceEvent[];
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, max = 86400): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export const spotifyTrackId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9]{22}$/.test(v);
export const spotifyContext = (v: unknown): v is string => typeof v === 'string' && /^(playlist|album)\/[a-zA-Z0-9]{22}$/.test(v);
export function validSnapshot(v: unknown): v is MixerSnapshot {
  if (!object(v) || !str(v.visualizer, 80) || !Array.isArray(v.stems) || v.stems.length < 1 || v.stems.length > 8) return false;
  if ((v.tempo !== undefined && !validTempo(v.tempo)) || (v.pitch !== undefined && !validPitch(v.pitch))) return false;
  const names = new Set<string>();
  for (const s of v.stems) {
    if (!object(s) || !str(s.name, 100) || names.has(s.name) || typeof s.input !== 'boolean' || !finite(s.volume, 2) ||
      typeof s.mute !== 'boolean' || typeof s.deafen !== 'boolean' || !str(s.effect, 40) || !finite(s.value, 1)) return false;
    if (s.effectSettings !== undefined && !validEffectSettings(s.effectSettings)) return false;
    names.add(s.name);
  }
  if (v.spotlight !== null) {
    const s = v.spotlight;
    if (!object(s) || !['track', 'track-with-selectors'].includes(String(s.level)) || !object(s.intent) ||
      !['input','output'].includes(String(s.intent.kind)) || (s.intent.kind === 'output' && !str(s.intent.name,100))) return false;
  }
  return true;
}
export function parseRecording(value: unknown): PerformanceRecording {
  if (object(value) && value.version === 1) throw new Error('This older recording has no reliable replay timing. Make a new recording with ktv420 6.2 or later.');
  if (!object(value) || (value.version !== 2 && value.version !== 3) || !str(value.name) || !str(value.createdAt,80) || !spotifyContext(value.spotifyPath) ||
    !Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > 500 || !Array.isArray(value.events) ||
    value.events.length < 2 || value.events.length > 30000) throw new Error('Not a supported ktv420 recording.');
  if (JSON.stringify(value).length > MAX_RECORDING_BYTES) throw new Error('Recording is too large (maximum 4 MB).');
  const ids = new Set<string>();
  for (const track of value.tracks) {
    if (!object(track) || !spotifyTrackId(track.id) || ids.has(track.id) || !str(track.title,500) || !finite(track.duration) || track.duration === 0) throw new Error('Invalid recorded song.');
    ids.add(track.id);
  }
  let at = 0, trackId = '';
  for (const [index, e] of value.events.entries()) {
    if (!object(e) || !finite(e.at) || e.at < at || !ids.has(String(e.trackId)) || !finite(e.position) ||
      !['track','mix','play','pause','seek','stop'].includes(String(e.type))) throw new Error('Invalid recording timeline.');
    if (e.type === 'track') trackId = String(e.trackId);
    if (trackId !== e.trackId || (index === 0 && (e.type !== 'track' || e.at !== 0)) ||
      (e.type === 'stop' && index !== value.events.length - 1) ||
      ((e.type === 'mix' || e.type === 'track') && !validSnapshot(e.snapshot))) throw new Error('Incomplete recording timeline.');
    if (value.version === 3 && (e.type === 'track' || e.type === 'mix') && (!object(e.snapshot) || !validTempo(e.snapshot.tempo) || !validPitch(e.snapshot.pitch))) throw new Error('Recording is missing tempo or pitch.');
    if (value.version === 2 && object(e.snapshot) && ((e.snapshot.tempo !== undefined && e.snapshot.tempo !== 1) || (e.snapshot.pitch !== undefined && e.snapshot.pitch !== 0))) throw new Error('Tempo recordings require version 3.');
    const track = (value.tracks as PerformanceRecording['tracks']).find(t => t.id === e.trackId)!;
    if (e.position > track.duration + 1) throw new Error('Song position is outside the recording.');
    at = e.at;
  }
  if (value.events.at(-1).type !== 'stop') throw new Error('This recording was not finished. Stop and save it first.');
  return value as PerformanceRecording;
}
export function parseRecordingText(text: string) {
  if (text.length > MAX_RECORDING_BYTES) throw new Error('Recording is too large (maximum 4 MB).');
  try { return parseRecording(JSON.parse(text)); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Choose a ktv420 JSON recording.');
    throw error;
  }
}

/** Independent of song position: a backwards seek must never rewind automation. */
export class PerformanceClock {
  private elapsed = 0;
  private since: number | null = null;
  private now: () => number;
  constructor(now = () => performance.now()) { this.now=now; }
  get seconds() { return this.elapsed + (this.since === null ? 0 : (this.now() - this.since) / 1000); }
  start() { if (this.since === null) this.since = this.now(); }
  pause() { this.elapsed = this.seconds; this.since = null; }
  reset() { this.elapsed = 0; this.since = null; }
}
export function dueEvents(events: PerformanceEvent[], cursor: number, seconds: number) {
  let end = cursor;
  while (end < events.length && events[end].at <= seconds) end++;
  return { events: events.slice(cursor,end), cursor: end };
}

export type MixerControl = {
  trackId: string; ready: boolean; position: () => number; snapshot: () => MixerSnapshot;
  play: () => Promise<void>; pause: () => number; seek: (position: number) => Promise<void>;
  apply: (snapshot: MixerSnapshot) => void;
};

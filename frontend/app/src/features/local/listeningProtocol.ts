import { validTempo } from '../stems/player/tempo';
export type ListeningState = {
  // Remix clock rate; Spotify’s native media element remains at 1×.
  tempoSupported?: boolean; playbackRate?: number;
  capability: 1; trackId: string; generation: number; position: number; duration: number;
  playing: boolean; local: boolean; output: 'muted' | 'capture' | 'stems'; volume: number;
  observedAt: number; error: string; title?: string; artist?: string; artwork?: string;
  canNext?: boolean; canPrevious?: boolean; capturing?: boolean;
};
export type TransportCommand = { action: 'play' | 'pause' | 'next' | 'previous' | 'enable' }
  | { action: 'seek'; position: number; trackId: string }
  | { action: 'select' | 'stems-failed'; trackId: string }
  | { action: 'rate'; rate: number; trackId: string }
  | { action: 'volume'; volume: number }
  | { action: 'silenced'; generation: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, max = 86400): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{1,100}$/.test(v);
export function parseTransportCommand(v: unknown): TransportCommand | null {
  if (!object(v)) return null;
  if (['play', 'pause', 'next', 'previous', 'enable'].includes(String(v.action))) return { action: v.action } as TransportCommand;
  if (v.action === 'rate' && validTempo(v.rate) && id(v.trackId)) return {action:'rate',rate:v.rate,trackId:v.trackId};
  if (v.action === 'silenced' && Number.isSafeInteger(v.generation) && number(v.generation, Number.MAX_SAFE_INTEGER)) return { action: 'silenced', generation: v.generation };
  if (v.action === 'volume' && number(v.volume, 1)) return { action: 'volume', volume: v.volume };
  if (v.action === 'seek' && id(v.trackId) && number(v.position)) return { action: 'seek', position: v.position, trackId: v.trackId };
  if ((v.action === 'select' || v.action === 'stems-failed') && id(v.trackId)) return { action: v.action, trackId: v.trackId };
  return null;
}
export function parseListeningState(v: unknown): ListeningState | null {
  if (!object(v) || v.capability !== 1 || !(v.trackId === '' || id(v.trackId)) || !number(v.generation, Number.MAX_SAFE_INTEGER) ||
    !number(v.position) || !number(v.duration) || typeof v.playing !== 'boolean' || typeof v.local !== 'boolean' ||
    !['muted','capture','stems'].includes(String(v.output)) || !number(v.volume, 1) || !number(v.observedAt, Number.MAX_SAFE_INTEGER) ||
    typeof v.error !== 'string' || v.error.length > 4096) return null;
  if (v.playbackRate !== undefined && !validTempo(v.playbackRate)) return null;
  return { tempoSupported: v.tempoSupported === true, playbackRate: typeof v.playbackRate === 'number' ? v.playbackRate : 1, capability: 1, trackId: v.trackId, generation: v.generation, position: v.position, duration: v.duration,
    playing: v.playing, local: v.local, output: v.output as ListeningState['output'], volume: v.volume,
    observedAt: v.observedAt, error: v.error, title: typeof v.title === 'string' ? v.title.slice(0,500) : '',
    artist: typeof v.artist === 'string' ? v.artist.slice(0,500) : '',
    canNext: v.canNext === true, canPrevious: v.canPrevious === true, capturing: v.capturing === true };
}

/** Captures can start slightly after Spotify's zero; preserve that alignment. */
export function captureStartSeconds(metadata?: Record<string, unknown> | null): number {
  const value = typeof metadata?.crop === 'string' ? Number(metadata.crop.split('-')[0]) : 0;
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
}

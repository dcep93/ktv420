import { validSnapshot, type MixerSnapshot } from './recording';
import { isAudioEffect } from '../stems/player/effects/catalog';
import { supportsVisualizer } from '../stems/player/visualizerOptions';

export const PLAYER_PREFERENCES_KEY = 'ktv420.player-preferences.v1';
type Preferences = { version: 1; mixer: MixerSnapshot | null; expanded: boolean };
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>;
type Schedule = (callback: () => void, delay: number) => () => void;
const defaults = (): Preferences => ({version:1,mixer:null,expanded:false});
function supportedMixer(value: unknown): value is MixerSnapshot {
  return validSnapshot(value) && supportsVisualizer(value.visualizer) && value.stems.every(stem => isAudioEffect(stem.effect));
}
function readPreferences(storage: StorageAccess, key: string): Preferences {
  try {
    const text = storage().getItem(key);
    if (!text || text.length > 65536) return defaults();
    const value = JSON.parse(text);
    if (!value || value.version !== 1 || typeof value.expanded !== 'boolean' ||
      (value.mixer !== null && !supportedMixer(value.mixer))) return defaults();
    return {version:1,mixer:value.mixer,expanded:value.expanded};
  } catch { return defaults(); }
}
const schedule: Schedule = (callback, delay) => {
  const timer = setTimeout(callback, delay); return () => clearTimeout(timer);
};

/** Memory updates immediately; only the small serialized preference write is debounced. */
export class PlayerPreferences {
  current: Preferences;
  private storage: StorageAccess;
  private key: string;
  private schedule: Schedule;
  private cancel: (() => void) | null = null;
  private pending: string | null = null;
  private saved: string;
  constructor(storage: StorageAccess, options: { key?: string; schedule?: Schedule } = {}) {
    this.storage = storage; this.key = options.key ?? PLAYER_PREFERENCES_KEY; this.schedule = options.schedule ?? schedule;
    this.current = readPreferences(storage, this.key); this.saved = JSON.stringify(this.current);
  }
  setMixer(mixer: MixerSnapshot) {
    if (!supportedMixer(mixer)) return;
    this.current = {...this.current,mixer:structuredClone(mixer)}; this.queue();
  }
  setExpanded(expanded: boolean) {
    this.current = {...this.current,expanded}; this.queue();
  }
  private queue() {
    this.cancel?.(); this.cancel = null;
    const text = JSON.stringify(this.current);
    this.pending = text === this.saved ? null : text;
    if (this.pending !== null) this.cancel = this.schedule(() => this.flush(), 150);
  }
  flush() {
    this.cancel?.(); this.cancel = null;
    if (this.pending === null) return;
    try {
      this.storage().setItem(this.key, this.pending);
      this.saved = this.pending; this.pending = null;
    } catch { /* Storage can be blocked/full. Keep working in memory and retry on the next flush. */ }
  }
}

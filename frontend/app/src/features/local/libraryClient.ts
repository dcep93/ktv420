import type { Mp3Files, Mp3Encoding } from './audio/mp3Types';
import type { PlaybackRecord } from '../stems/player/types';
import type { LocalTrack, TrackStatus } from './library';
import { STEM_NAMES } from './library';
export { STEM_NAMES };
export type { LocalTrack };

const SOURCE = 'ktv420-library';
const VERSION = 2;
type Envelope = { source: string; version: number; id: string; ok: boolean; result?: unknown; error?: string };
type Transport = {
  send: (message: unknown) => void;
  subscribe: (receive: (data: Envelope) => void) => () => void;
};

/** The transport authenticates the window/origin before delivering a response. */
export function createLibraryClient(transport: Transport, timeoutMs = 60000) {
  const sessionId = crypto.randomUUID();
  let serial = 0;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const unsubscribe = transport.subscribe(data => {
    if (!data || data.source !== SOURCE || typeof data.id !== 'string') return;
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(data.id);
    if (data.version !== VERSION) request.reject(new Error('This player needs a newer ktv420 extension. Update the extension and reload Spotify.'));
    else if (data.ok === true) request.resolve(data.result);
    else request.reject(new Error(typeof data.error === 'string' ? data.error : 'Local storage request failed.'));
  });
  let disposed = false;
  return {
    request<T>(method: string, args: unknown[] = []): Promise<T> {
      if (disposed) return Promise.reject(new Error('The ktv420 storage connection is closed.'));
      if (pending.size >= 32) return Promise.reject(new Error('Too many pending local storage requests.'));
      const id = `${sessionId}-${++serial}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('The ktv420 extension did not respond. Reload Spotify and reopen ktv420.'));
        }, timeoutMs);
        pending.set(id, { resolve: value => resolve(value as T), reject, timer });
        try { transport.send({ source: SOURCE, version: VERSION, id, method, args }); }
        catch (reason) { clearTimeout(timer); pending.delete(id); reject(reason); }
      });
    },
    dispose() {
      disposed = true; unsubscribe();
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The ktv420 storage connection was closed.')); }
      pending.clear();
    },
  };
}

export function brokerOrigin(): string {
  const origin = new URLSearchParams(window.location.search).get('brokerOrigin') || '';
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (import.meta.env.DEV && [`http://localhost:${location.port}`, `http://127.0.0.1:${location.port}`].includes(origin)) return origin;
  throw new Error('Open ktv420 from its extension on Spotify to access your local audio.');
}
let client: ReturnType<typeof createLibraryClient> | undefined;
function request<T>(method: string, args: unknown[] = []): Promise<T> {
  try {
    if (!client) {
      if (window.parent === window) throw new Error('Open ktv420 on Spotify to access your local audio.');
      const origin = brokerOrigin();
      client = createLibraryClient({
        send: message => window.parent.postMessage(message, origin),
        subscribe: receive => {
          const listener = (event: MessageEvent) => {
            if (event.origin === origin && event.source === window.parent) receive(event.data);
          };
          window.addEventListener('message', listener);
          return () => window.removeEventListener('message', listener);
        },
      });
      window.addEventListener('pagehide', () => { client?.dispose(); client = undefined; }, { once: true });
    }
    return client.request<T>(method, args);
  } catch (error) { return Promise.reject(error); }
}
export const listTracks = () => request<LocalTrack[]>('listTracks');
export const getTrack = (id: string) => request<LocalTrack | undefined>('getTrack', [id]);
export const getInput = (id: string) => request<Blob>('getInput', [id]);
export const getPlaybackRecord = (id: string) => request<PlaybackRecord>('getPlaybackRecord', [id]);
export const deleteTrack = (id: string) => request<void>('deleteTrack', [id]);
export const setTrackStatus = (id: string, status: TrackStatus, error?: string) => request<void>('setTrackStatus', [id, status, error]);
export const saveMp3 = (id: string, files: Mp3Files, metadata: Record<string, unknown>, encoding: Mp3Encoding) => request<void>('saveMp3', [id, files, metadata, encoding]);
export const getProcessingEnabled = () => request<boolean>('getProcessingEnabled');
export const setProcessingEnabled = (enabled: boolean) => request<void>('setProcessingEnabled', [enabled]);
export async function withProcessingLock<T>(run: (acquired: boolean) => Promise<T>): Promise<T> {
  const acquired = await request<boolean>('acquireLock');
  try { return await run(acquired); }
  finally { if (acquired) await request<void>('releaseLock'); }
}

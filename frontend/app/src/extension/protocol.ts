import { AUDIO_NAMES, parsePrepared } from '../shared/preparedAudio';
import { decodeChunk } from '../shared/captureFormat';
import { parseLibrarySummary } from '../shared/librarySummary';
export const PROTOCOL_VERSION = 1;
export const APP_ORIGIN = 'https://ktv420.web.app';
export function websiteSender(sender: { url?: string; frameId?: number }) {
  try {
    return new URL(sender.url || '').origin === APP_ORIGIN && sender.frameId === 0;
  } catch {
    return false;
  }
}
export function parseRequest(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid request.');
  const r = value as Record<string, unknown>;
  if (
    r.protocol !== 'ktv420-spotify' ||
    r.version !== PROTOCOL_VERSION ||
    typeof r.operation !== 'string' ||
    ![
      'hello', 'work-state', 'work-config', 'work-failure', 'work-recover', 'return-begin', 'return-chunk', 'return-finish', 'staging-list', 'staging-delete',
      'claim-capture', 'release-capture', 'prepared', 'prepared-chunk', 'ack-prepared',
      'work-pending', 'work-claim', 'work-chunk', 'work-touch', 'work-release', 'work-begin', 'work-append', 'work-finish',
      'library-summary',
      'collections',
      'ack-collection',
      'publish-library',
      'open-player',
      'discover',
      'status',
      'capture',
      'cancel',
      'volume',
      'pending',
      'chunk',
      'ack',
      'close',
      'view',
      'presentation',
    ].includes(r.operation)
  )
    throw new Error('Update the ktv420 Spotify extension.');
  if (r.operation === 'ack-collection' && (typeof r.path !== 'string' || !/^(album|playlist)\/[A-Za-z0-9]{22}$/.test(r.path) || typeof r.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(r.requestId))) throw new Error('Invalid collection acknowledgment.');
  if ('revision' in r && (!Number.isSafeInteger(r.revision) || Number(r.revision) < 0)) throw new Error('Invalid library revision.');
  if (r.operation === 'publish-library') r.tracks = parseLibrarySummary(r.tracks);
  if (r.operation === 'open-player' && (typeof r.path !== 'string' || !/^(album|playlist)\/[A-Za-z0-9]{22}$/.test(r.path) || (r.trackIndex !== null && (!Number.isSafeInteger(r.trackIndex) || Number(r.trackIndex) < 1 || Number(r.trackIndex) > 10000)))) throw new Error('Invalid player link.');
  if (r.operation === 'staging-delete' && (!Array.isArray(r.ids) || !r.ids.length || r.ids.length > 10000 ||
      r.ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)))) throw new Error('Invalid staging deletion.');
  if (r.operation === 'work-config' && (typeof r.enabled !== 'boolean' || ('retry' in r && typeof r.retry !== 'boolean'))) throw new Error('Invalid queue preference.');
  if ('backend' in r && !['auto', 'wasm'].includes(String(r.backend))) throw new Error('Invalid separation device.');
  if (r.operation === 'work-failure' && (typeof r.error !== 'string' || !r.error.length || r.error.length > 500)) throw new Error('Invalid processing error.');
  if ('discarded' in r && typeof r.discarded !== 'boolean') throw new Error('Invalid delivery acknowledgment.');
  if ('transient' in r && typeof r.transient !== 'boolean') throw new Error('Invalid retry classification.');
  if ('recoverOnReload' in r && typeof r.recoverOnReload !== 'boolean') throw new Error('Invalid recovery flag.');
  if (r.operation.startsWith('return-')) {
    if (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id)) throw new Error('Invalid returned capture ID.');
    if (r.operation === 'return-chunk') {
      if (!Number.isSafeInteger(r.index) || Number(r.index) < 0 || Number(r.index) > 4096) throw new Error('Invalid returned chunk.');
      decodeChunk(r.base64);
    }
    if (r.operation === 'return-begin' && (!r.metadata || typeof r.metadata !== 'object' || !Number.isSafeInteger(r.bytes))) throw new Error('Invalid returned capture.');
  }
  const work = r.operation.startsWith('work-') && !['work-state', 'work-config', 'work-recover'].includes(r.operation);
  if ((work && r.operation !== 'work-pending') || ['claim-capture', 'release-capture', 'prepared-chunk', 'ack-prepared'].includes(r.operation)) {
    if (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id)) throw new Error('Invalid staging ID.');
  }
  if ((work && !['work-pending', 'work-claim'].includes(r.operation)) || r.operation === 'release-capture' || 'token' in r) {
    if (typeof r.token !== 'string' || !/^[a-f0-9-]{36}$/.test(r.token)) throw new Error('Invalid staging token.');
  }
  if (['prepared-chunk', 'work-append', 'work-chunk'].includes(r.operation) && (!Number.isSafeInteger(r.index) || Number(r.index) < 0 || Number(r.index) > 4096)) throw new Error('Invalid staging chunk.');
  if (['prepared-chunk', 'work-append'].includes(r.operation) && !AUDIO_NAMES.includes(r.name as typeof AUDIO_NAMES[number])) throw new Error('Invalid staging file.');
  if (r.operation === 'work-begin') {
    r.manifest = parsePrepared(r.manifest);
    if (r.id !== (r.manifest as { id: string }).id) throw new Error('Mismatched staging ID.');
  }
  if (r.operation === 'work-append') decodeChunk(r.base64);
  if ('progress' in r) {
    const p = r.progress as { fraction: number; message: string };
    if (!p || !Number.isFinite(p.fraction) || p.fraction < 0 || p.fraction > 1 || typeof p.message !== 'string' || p.message.length > 500) throw new Error('Invalid processing progress.');
    r.progress = { fraction: p.fraction, message: p.message };
  }
  if ('tabId' in r) throw new Error('Spotify is bound to the overlay, not a supplied tab.');
  if (r.operation === 'view' && r.trackIndex !== null &&
    (!Number.isSafeInteger(r.trackIndex) || Number(r.trackIndex) < 1 || Number(r.trackIndex) > 10000))
    throw new Error('Invalid track index.');
  if (r.operation === 'presentation' && (typeof r.title !== 'string' || r.title.length > 500))
    throw new Error('Invalid title.');
  if (
    r.operation === 'capture' &&
    (typeof r.path !== 'string' ||
      !/^(album|playlist)\/[A-Za-z0-9]{22}$/.test(r.path) ||
      typeof r.trackId !== 'string' ||
      !/^[A-Za-z0-9]{1,100}$/.test(r.trackId) ||
      typeof r.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(r.requestId))
  )
    throw new Error('Invalid capture request.');
  if (
    ['chunk', 'ack'].includes(r.operation) &&
    (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id))
  )
    throw new Error('Invalid delivery ID.');
  if (r.operation === 'chunk' && (!Number.isSafeInteger(r.index) || Number(r.index) < 0))
    throw new Error('Invalid chunk index.');
  if (
    r.operation === 'volume' &&
    (typeof r.volume !== 'number' || !Number.isFinite(r.volume) || r.volume < 0 || r.volume > 1)
  )
    throw new Error('Invalid monitor volume.');
  return Object.fromEntries(
    [
      'protocol',
      'version',
      'operation',
      'trackIndex',
      'replace',
      'title',
      'trackId',
      'requestId',
      'path',
      'id',
      'index',
      'volume',
      'ids', 'tracks', 'revision', 'token', 'name', 'manifest', 'base64', 'progress', 'enabled', 'retry', 'backend', 'error', 'metadata', 'bytes', 'recoverOnReload', 'transient', 'discarded',
    ]
      .filter((key) => key in r)
      .map((key) => [key, r[key]]),
  );
}

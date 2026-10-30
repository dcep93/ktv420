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
      'hello',
      'discover',
      'status',
      'capture',
      'cancel',
      'volume',
      'pending',
      'chunk',
      'ack',
    ].includes(r.operation)
  )
    throw new Error('Update the ktv420 Spotify extension.');
  if (
    ['discover', 'status', 'capture', 'cancel', 'volume'].includes(r.operation) &&
    (!Number.isSafeInteger(r.tabId) || Number(r.tabId) < 0)
  )
    throw new Error('Invalid Spotify tab.');
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
      'tabId',
      'trackId',
      'requestId',
      'path',
      'id',
      'index',
      'volume',
    ]
      .filter((key) => key in r)
      .map((key) => [key, r[key]]),
  );
}

export const MODEL = Object.freeze({
  name: 'htdemucs-split-fp32',
  revision: '92e33df61cfc9eb820272aaa62d2ef6dcf4d950d',
  sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
  bytes: 180534758,
  sampleRate: 44100,
  segmentFrames: 343980,
  url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx',
})
export const MODEL_CACHE_NAME = 'ktv420-demucs-split-fp32-v1'

export async function getModelCacheStatus(): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    return Boolean(await cache.match(MODEL.url))
  } catch { return false }
}

export async function clearModelCache(): Promise<void> {
  if ('caches' in globalThis) await caches.delete(MODEL_CACHE_NAME)
}

export async function verifyModelBytes(bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength !== MODEL.bytes) throw new Error('The model download has the wrong length. Please retry.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
  if (hex !== MODEL.sha256) throw new Error('Model integrity verification failed. Please retry the download.')
}

/** Only immutable model data is fetched remotely; executable JS/WASM is served with the hosted player. */
export async function loadModelBytes(onDownload: (fraction: number) => void,
  options: { requireCache?: boolean; onActivity?: (message: string) => void } = {}): Promise<ArrayBuffer> {
  let cache: Cache | undefined
  options.onActivity?.('Checking cached model…')
  try { if ('caches' in globalThis) cache = await caches.open(MODEL_CACHE_NAME) } catch { /* Storage can be denied. */ }
  try {
    const cached = await cache?.match(MODEL.url)
    if (cached) {
      try {
        options.onActivity?.('Reading cached model…')
        const bytes = await cached.arrayBuffer()
        options.onActivity?.('Verifying cached model…')
        await verifyModelBytes(bytes)
        onDownload(1)
        options.onActivity?.('Cached model verified')
        return bytes
      } catch {
        // Corrupt/unreadable cached data must never prevent a fresh verified fetch.
        try { await cache?.delete(MODEL.url) } catch { /* Cache storage is optional. */ }
      }
    }
  } catch { cache = undefined }
  if (options.requireCache && !cache) throw new Error('Chrome cannot save the model. Allow site storage and try again.')
  options.onActivity?.('Connecting to model download…')
  const response = await fetch(MODEL.url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`)
  const result = new Uint8Array(MODEL.bytes)
  if (response.body) {
    const reader = response.body.getReader()
    let position = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (position + value.length > result.length) throw new Error('Model download exceeds the pinned size.')
        result.set(value, position); position += value.length
        onDownload(position / result.length)
      }
      if (position !== result.length) throw new Error('The model download was interrupted.')
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  } else {
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== result.length) throw new Error('The model download has the wrong length.')
    result.set(new Uint8Array(bytes))
  }
  options.onActivity?.('Verifying downloaded model…')
  await verifyModelBytes(result.buffer)
  // A cache quota failure must not prevent local separation in this session.
  options.onActivity?.('Saving downloaded model…')
  try { await cache?.put(MODEL.url, new Response(result, { headers: { 'Content-Type': 'application/octet-stream' } })) }
  catch {
    if (options.requireCache) throw new Error('The model could not be saved. Free some local storage and try again.')
    // Inference can still use the verified bytes without persistent cache.
  }
  onDownload(1)
  return result.buffer
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { getModelCacheStatus, loadModelBytes, MODEL } from './model.ts'

test('explicit model download fails before fetching when persistent storage is unavailable', async () => {
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const originalFetch = globalThis.fetch
  let fetched = false
  try {
    globalThis.fetch = async () => { fetched = true; throw new Error('Unexpected download') }
    for (const cacheApi of [undefined, { open: async () => { throw new Error('Storage denied') } }]) {
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: cacheApi })
      await assert.rejects(loadModelBytes(() => undefined, { requireCache: true }), /cannot save the model/)
    }
    assert.equal(fetched, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches)
    else Reflect.deleteProperty(globalThis, 'caches')
  }
})

test('cache access failures do not prevent the network path or break cache status', async () => {
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const originalFetch = globalThis.fetch
  const fail = async () => { throw new Error('Cache storage unavailable') }
  const cases = [
    { open: fail },
    { open: async () => ({ match: fail }) },
    { open: async () => ({ match: async () => ({ arrayBuffer: fail }), delete: fail }) },
    { open: async () => ({ match: async () => ({ arrayBuffer: async () => new ArrayBuffer(3) }), delete: fail }) },
  ]
  try {
    for (const mock of cases) {
      let requested = false
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: mock })
      globalThis.fetch = async (url, options) => {
        requested = true
        assert.equal(url, MODEL.url)
        assert.equal(options?.credentials, 'omit')
        throw new Error('Network path reached')
      }
      await assert.rejects(loadModelBytes(() => undefined), /Network path reached/)
      assert.equal(requested, true)
    }
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: fail } })
    assert.equal(await getModelCacheStatus(), false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches)
    else Reflect.deleteProperty(globalThis, 'caches')
  }
})

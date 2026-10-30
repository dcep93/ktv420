/** Conservatively allow a staged and committed copy plus overhead. Does not delete user audio. */
export async function requireStorage(bytes: number) {
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
  if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < bytes * 2 + 32 * 1024 ** 2)
    throw new DOMException('Not enough browser storage to save this audio. Free space, then retry; the original is unchanged.', 'QuotaExceededError');
}

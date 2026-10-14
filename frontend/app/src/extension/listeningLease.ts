export type ListeningLease = { tabId: number; expires: number };
export function claimListeningLease(previous: ListeningLease | undefined, tabId: number, now: number): ListeningLease {
  return previous && previous.tabId !== tabId && previous.expires > now ? previous : { tabId, expires: now + 3000 };
}

import { recoverStalledWork } from './workerHealth';
import { recoverQueue } from './queueRecovery';
/** No audio work in the MV3 service worker. Concurrent callers share one document. */
let creating: Promise<void> | undefined;
let healthRequested = false;
export async function ensureWorkerHost(heal = false) {
  if (!chrome.offscreen || !chrome.runtime.getContexts) return;
  healthRequested ||= heal;
  if (creating) return creating;
  creating = (async () => {
    const url = chrome.runtime.getURL('src/worker/index.html');
    let contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
    const checkHealth = healthRequested; healthRequested = false;
    if (contexts.length && checkHealth && await recoverStalledWork()) {
      await chrome.offscreen.closeDocument();
      contexts = [];
    }
    if (!contexts.length) {
      const tabs = await chrome.tabs.query({}); await recoverQueue(new Set(tabs.flatMap(t => t.id === undefined ? [] : [t.id])));
      try { await chrome.offscreen.createDocument({ url, reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Separate locally captured audio in a worker that survives closing or refreshing Spotify and ktv420 views.' }); }
      catch (error) {
        // Chrome can finish a creation dispatched just before an MV3 worker restart.
        const current = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
        if (!current.length) throw error;
      }
    }
  })().finally(() => { creating = undefined; });
  return creating;
}

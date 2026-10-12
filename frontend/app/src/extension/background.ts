import { beginCapture, appendCapture, finishCapture } from './capture';
import { listTracks } from '../features/local/library';

let opening: Promise<void> | undefined;
async function openLibrary() {
  if (opening) return opening;
  opening = (async () => {
    const url = chrome.runtime.getURL('build/index.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
    if (contexts[0]?.tabId !== undefined && contexts[0].tabId >= 0) {
      await chrome.tabs.update(contexts[0].tabId, { active: true });
      if (contexts[0].windowId >= 0) await chrome.windows.update(contexts[0].windowId, { focused: true });
    } else await chrome.tabs.create({ url });
  })().finally(() => { opening = undefined; });
  return opening;
}
chrome.action.onClicked.addListener(() => { void openLibrary(); });
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof sender.tab?.id !== 'number' || !sender.url?.startsWith('https://open.spotify.com/') ||
    !message || typeof message !== 'object' || !('type' in message)) return false;
  const request = message as { type: string; metadata: Record<string, unknown>; bytes: number; id: string; index: number; base64: string };
  const tabId = sender.tab.id;
  const handle = async () => {
    switch (request.type) {
      case 'ktv420:open': await openLibrary(); return null;
      case 'ktv420:cached': return (await listTracks()).filter(track => track.source === 'spotify').map(track => track.metadata);
      case 'ktv420:capture-begin': return beginCapture(tabId, request.metadata, request.bytes);
      case 'ktv420:capture-chunk': await appendCapture(tabId, request.id, request.index, request.base64); return null;
      case 'ktv420:capture-finish': await finishCapture(tabId, request.id); return null;
      default: throw new Error('Unknown ktv420 command.');
    }
  };
  void handle().then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

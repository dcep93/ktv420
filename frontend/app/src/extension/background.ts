import { APP_ORIGIN, parseRequest, websiteSender } from './protocol';
import {
  beginCapture,
  appendCapture,
  finishCapture,
  pendingCaptures,
  readChunk,
  acknowledgeCapture,
} from './queue';
async function openApp(tabId: number, path: string) {
  if (!/^(album|playlist)\/[A-Za-z0-9]{22}$/.test(path))
    throw new Error('Open a Spotify playlist or album.');
  const url = `${APP_ORIGIN}/playlist?id=${path.replace('/', '.')}&spotifyTab=${tabId}&extension=${chrome.runtime.id}`;
  const tabs = await chrome.tabs.query({ url: `${APP_ORIGIN}/*` });
  const target = tabs.find((tab) => tab.url?.includes(`id=${path.replace('/', '.')}`));
  if (target?.id !== undefined) {
    await chrome.tabs.update(target.id, { url, active: true });
    await chrome.windows.update(target.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined && tab.url?.startsWith('https://open.spotify.com/'))
    void chrome.tabs.sendMessage(tab.id, { type: 'ktv420:show-controls' }).catch(() => {});
  else void chrome.tabs.create({ url: APP_ORIGIN });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    typeof sender.tab?.id !== 'number' ||
    !sender.url?.startsWith('https://open.spotify.com/') ||
    !message ||
    typeof message !== 'object'
  )
    return false;
  const tabId = sender.tab.id;
  const handle = async () => {
    switch (message.type) {
      case 'ktv420:open-app': {
        // sender.url can retain the document's initial URL after Spotify's SPA navigation.
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url?.startsWith('https://open.spotify.com/'))
          throw new Error('Spotify tab is unavailable.');
        return openApp(tabId, new URL(tab.url).pathname.slice(1).replace(/\/$/, ''));
      }
      case 'ktv420:cached':
        return (await pendingCaptures()).map((c) => c.metadata);
      case 'ktv420:capture-begin':
        return beginCapture(tabId, message.metadata, message.bytes);
      case 'ktv420:capture-chunk':
        return appendCapture(tabId, message.id, message.index, message.base64);
      case 'ktv420:capture-finish':
        return finishCapture(tabId, message.id);
      default:
        throw new Error('Unknown Spotify integration operation.');
    }
  };
  void handle().then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true;
});
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!websiteSender(sender)) return false;
  const handle = async () => {
    const r = parseRequest(message);
    switch (r.operation) {
      case 'hello':
        return { version: 1, extensionVersion: chrome.runtime.getManifest().version };
      case 'pending':
        return pendingCaptures();
      case 'chunk':
        return readChunk(String(r.id), Number(r.index));
      case 'ack':
        return acknowledgeCapture(String(r.id));
      default: {
        const tab = await chrome.tabs.get(Number(r.tabId));
        if (!tab.url?.startsWith('https://open.spotify.com/'))
          throw new Error('Spotify tab is unavailable.');
        const response = await chrome.tabs.sendMessage(tab.id!, { type: 'ktv420:command', ...r });
        if (!response?.ok) throw new Error(response?.error || 'Reload Spotify.');
        return response.result;
      }
    }
  };
  void handle().then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true;
});

import { APP_ORIGIN, parseRequest, websiteSender } from './protocol';
import {
  beginCapture,
  appendCapture,
  finishCapture,
  pendingCaptures,
  readChunk,
  acknowledgeCapture,
  readLibrarySummary,
  publishLibrarySummary,
  rememberPlayerCollection,
  playerCollections,
  acknowledgePlayerCollection,
} from './queue';
async function request(message: unknown, tabId?: number) {
  const r = parseRequest(message);
  switch (r.operation) {
    case 'hello': return { version: 1, extensionVersion: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id };
    case 'ack-collection': {
      if (tabId !== undefined) throw new Error('Only the website receives playlist metadata.');
      return acknowledgePlayerCollection(String(r.path), String(r.requestId));
    }
    case 'collections': return playerCollections();
    case 'library-summary': return readLibrarySummary();
    case 'publish-library': {
      if (tabId !== undefined) throw new Error('Only the standalone website publishes library status.');
      return publishLibrarySummary(r.tracks);
    }
    case 'pending': { if (tabId !== undefined) throw new Error('Open ktv420 to receive audio.'); return pendingCaptures(); }
    case 'chunk': if (tabId !== undefined) throw new Error('Open ktv420 to receive audio.'); return readChunk(String(r.id), Number(r.index));
    case 'ack': if (tabId !== undefined) throw new Error('Open ktv420 to receive audio.'); return acknowledgeCapture(String(r.id));
    default: {
      if (tabId === undefined) throw new Error('Open ktv420 over a Spotify playlist to capture.');
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.startsWith('https://open.spotify.com/')) throw new Error('Spotify tab is unavailable.');
      if (r.operation === 'open-player') {
        if (new URL(tab.url).pathname.replace(/\/$/, '').slice(1) !== r.path) throw new Error('Spotify changed playlists.');
        const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'ktv420:command', ...r, operation: 'discover' }, { frameId: 0 });
        if (!snapshot?.ok || snapshot.result?.collection?.path !== r.path) throw new Error('Spotify playlist changed.');
        await rememberPlayerCollection(snapshot.result);
        const url = new URL('/playlist', APP_ORIGIN);
        url.searchParams.set('id', String(r.path).replace('/', '.'));
        if (r.trackIndex !== null) url.searchParams.set('ktv420', String(r.trackIndex));
        url.searchParams.set('extension', chrome.runtime.id);
        await chrome.tabs.create({ url: url.href });
        return;
      }
      const response = await chrome.tabs.sendMessage(tabId, { type: 'ktv420:command', ...r }, { frameId: 0 });
      if (!response?.ok) throw new Error(response?.error || 'Reload Spotify.');
      return response.result;
    }
  }
}
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined && tab.url?.startsWith('https://open.spotify.com/'))
    void chrome.tabs.sendMessage(tab.id, { type: 'ktv420:show-controls' }).catch(() => {});
  else void chrome.tabs.create({ url: APP_ORIGIN });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && typeof sender.tab?.id === 'number' &&
      (sender.frameId ?? 0) > 0 && sender.url?.split('?')[0] === chrome.runtime.getURL('src/overlay/index.html') &&
      message?.type === 'ktv420:overlay-request') {
    void request(message.request, sender.tab.id).then(
      result => respond({ ok: true, result }),
      error => respond({ ok: false, error: String(error.message || error) }),
    );
    return true;
  }
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
    return request(message);
  };
  void handle().then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true;
});

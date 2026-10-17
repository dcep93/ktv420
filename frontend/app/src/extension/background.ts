import { parseRecording } from '../features/local/recording';
import { claimListeningLease } from './listeningLease';
import { readState, updateState } from './state';
import { beginCapture, appendCapture, finishCapture } from './capture';
import { listTracks } from '../features/local/library';

chrome.action.onClicked.addListener(tab => {
  void (async () => {
    const spotify = tab.url?.startsWith('https://open.spotify.com/') ? tab :
      (await chrome.tabs.query({ url: 'https://open.spotify.com/*' }))[0];
    if (spotify?.id !== undefined) {
      await chrome.tabs.update(spotify.id, { active: true });
      if (spotify.windowId >= 0) await chrome.windows.update(spotify.windowId, { focused: true });
      await chrome.tabs.sendMessage(spotify.id, { type: 'ktv420:show-overlay' });
    } else await chrome.tabs.create({ url: 'https://open.spotify.com/' });
  })().catch(error => console.error('Reload Spotify to open ktv420.', error));
});
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof sender.tab?.id !== 'number' || !sender.url?.startsWith('https://open.spotify.com/') ||
    !message || typeof message !== 'object' || !('type' in message)) return false;
  const request = message as { type: string; metadata: Record<string, unknown>; bytes: number; id: string; index: number; base64: string };
  const tabId = sender.tab.id;
  const handle = async () => {
    switch (request.type) {
      case 'ktv420:clear-replay': {
        await updateState('pendingReplay', previous => previous?.tabId === tabId ? undefined : previous);
        return null;
      }
      case 'ktv420:pending-replay': {
        const pendingReplay = await readState('pendingReplay');
        return pendingReplay?.tabId === tabId && new URL(sender.url!).pathname === `/${pendingReplay.recording.spotifyPath}` ? pendingReplay.recording : null;
      }
      case 'ktv420:listening-claim': {
        const lease = await updateState('listeningLease', previous => claimListeningLease(previous, tabId, Date.now()));
        return lease?.tabId === tabId;
      }
      case 'ktv420:library-status': return (await listTracks()).filter(track => track.source === 'spotify').map(track => ({ trackId: track.metadata?.trackId, status: track.status }));
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

// The website can only hand off validated instructions; it cannot read local audio.
chrome.runtime.onMessageExternal.addListener((message: unknown, sender, respond) => {
  let url: URL;
  try { url = new URL(sender.url || ''); } catch { return false; }
  if (url.origin !== 'https://ktv420.web.app' || url.pathname.replace(/\/$/,'') !== '/replay' || (sender.frameId !== undefined && sender.frameId !== 0) ||
    !message || typeof message !== 'object' || !('type' in message)) return false;
  if (message.type === 'ktv420:replay-ping') { respond({ok:true,version:chrome.runtime.getManifest().version}); return false; }
  if (message.type !== 'ktv420:open-replay' || !('recording' in message)) return false;
  void (async () => {
    const recording = parseRecording(message.recording);
    // Create blank first, persist before navigation: content scripts cannot race the handoff.
    const tab = await chrome.tabs.create({ url: 'about:blank', active:true });
    if (tab.id === undefined) throw new Error('Could not open Spotify.');
    await updateState('pendingReplay', () => ({ tabId:tab.id!, recording }));
    await chrome.tabs.update(tab.id,{url:`https://open.spotify.com/${recording.spotifyPath}`});
    return {ok:true};
  })().then(respond,error => respond({ok:false,error:error instanceof Error ? error.message : String(error)}));
  return true;
});

import { recoverQueue, recoverCaptureDocument } from './queueRecovery';
import { ensureWorkerHost } from './workerHost';
import { workState, configureWork, claimWork, failWork, recoverWorker, type WorkerOwner } from './workQueue';
import { beginReturnedCapture, appendReturnedCapture, finishReturnedCapture } from './returnedCapture';
import { listStagedAudio, deleteStagedAudio } from './stagedLibrary';
import { touchClaim, releaseClaim, stagedSummary, preparedCaptures, beginPrepared, appendPrepared, finishPrepared, preparedChunk, acknowledgePrepared } from './staging';
import type { AudioName } from '../shared/preparedAudio';
import { APP_ORIGIN, parseRequest, websiteSender } from './protocol';
import {
  acknowledgeCapture,
  beginCapture,
  appendCapture,
  finishCapture,
  pendingCaptures,
  readChunk,
  publishLibrarySummary,
  rememberPlayerCollection,
  playerCollections,
  acknowledgePlayerCollection,
} from './queue';
async function request(message: unknown, tabId?: number, websiteTabId?: number, documentId?: string, backgroundWorker = false) {
  const r = parseRequest(message);
  if (String(r.operation).startsWith('work-')) {
    if (r.operation === 'work-state') return workState();
    if (r.operation === 'work-config') { await configureWork(r.enabled as boolean, r.retry === true, r.backend as 'auto' | 'wasm' | undefined); await ensureWorkerHost(r.retry === true); return; }
    const boundTab = tabId ?? websiteTabId;
    if (!backgroundWorker && !['work-state', 'work-config', 'work-pending'].includes(String(r.operation))) throw new Error('Separation runs in the extension background. Refresh this view.');
    if (!backgroundWorker && boundTab === undefined) throw new Error('A ktv420 view must own the worker.');
    const owner: WorkerOwner = backgroundWorker ? 'worker:background' : `worker:${boundTab!}`;
    if (r.operation === 'work-recover') {
      if (!documentId) throw new Error('Reload this page to reconnect separation.');
      return recoverWorker(owner, documentId);
    }
    const id = String(r.id), token = String(r.token);
    switch (r.operation) {
      case 'work-commit': {
        await touchClaim(id, token, owner);
        const capture = (await pendingCaptures()).find(c => c.id === id);
        if (!capture) return;
        if (r.discarded !== true) {
          const tracks = r.tracks as { id: string; status: string }[];
          if (!tracks?.some(t => t.id === `spotify-${capture.metadata.trackId}` && t.status === 'ready')) throw new Error('Shared stems are not committed.');
          await publishLibrarySummary(tracks, r.revision as number);
        }
        return acknowledgeCapture(id, token);
      }
      case 'work-failure': return failWork(id, token, owner, String(r.error), r.recoverOnReload === true, r.transient === true);
      case 'work-pending': return pendingCaptures();
      case 'work-claim': return claimWork(id, owner, documentId);
      case 'work-touch': return touchClaim(id, token, owner, r.progress as { fraction: number; message: string } | undefined);
      case 'work-release': return releaseClaim(id, token, owner);
      case 'work-chunk': await touchClaim(id, token, owner); return readChunk(id, Number(r.index), token);
      case 'work-begin': return beginPrepared(r.manifest, token, owner);
      case 'work-append': return appendPrepared(id, token, owner, r.name as AudioName, Number(r.index), String(r.base64));
      case 'work-finish': return finishPrepared(id, token, owner);
    }
  }
  switch (r.operation) {
    case 'return-begin':
    case 'return-chunk':
    case 'return-finish':
      if (tabId !== undefined) throw new Error('Only the website returns imported originals.');
      if (r.operation === 'return-begin') return beginReturnedCapture(String(r.id), r.metadata as Record<string, unknown>, Number(r.bytes));
      if (r.operation === 'return-chunk') return appendReturnedCapture(String(r.id), Number(r.index), String(r.base64));
      return finishReturnedCapture(String(r.id));
    case 'staging-list':
    case 'staging-delete':
      if (tabId === undefined) throw new Error('Only the Spotify overlay manages extension audio.');
      return r.operation === 'staging-list' ? listStagedAudio() : deleteStagedAudio(r.ids as string[]);
    case 'hello': await ensureWorkerHost(!backgroundWorker && r.heal === true); return { version: 1, extensionVersion: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id, stagedAudio: true, stagedAudioControls: true, extensionQueue: true, workRecovery: true, backgroundQueue: true, sharedLibrary: true };
    case 'ack-collection': {
      if (tabId !== undefined) throw new Error('Only the website receives playlist metadata.');
      return acknowledgePlayerCollection(String(r.path), String(r.requestId));
    }
    case 'collections': return playerCollections();
    case 'library-summary': return stagedSummary(true);
    case 'claim-capture':
    case 'release-capture':
    case 'pending':
    case 'chunk':
    case 'ack': throw new Error('Raw captures stay in the extension until separation finishes. Refresh ktv420.');
    case 'prepared': if (tabId !== undefined) throw new Error('Only the website imports audio.'); return preparedCaptures();
    case 'prepared-chunk': if (tabId !== undefined) throw new Error('Only the website imports audio.'); return preparedChunk(String(r.id), r.name as AudioName, Number(r.index));
    case 'ack-prepared': if (tabId !== undefined) throw new Error('Only the website imports audio.'); return acknowledgePrepared(String(r.id), r.discarded === true);
    case 'publish-library': {
      if (tabId !== undefined) throw new Error('Only the standalone website publishes library status.');
      return publishLibrarySummary(r.tracks, r.revision as number | undefined);
    }
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
  if (sender.id === chrome.runtime.id && sender.tab === undefined && sender.url === chrome.runtime.getURL('src/worker/index.html') &&
      message?.type === 'ktv420:worker-request' && /^[a-f0-9-]{36}$/.test(message.session || '') &&
      ['hello', 'work-state', 'work-recover', 'work-pending', 'work-claim', 'work-touch', 'work-chunk', 'work-begin', 'work-append', 'work-finish', 'work-failure', 'work-release', 'work-commit', 'prepared', 'prepared-chunk', 'ack-prepared', 'collections', 'ack-collection', 'publish-library', 'return-begin', 'return-chunk', 'return-finish'].includes(message.request?.operation)) {
    void request(message.request, undefined, undefined, `${sender.documentId}/${message.session}`, true).then(
      result => respond({ ok: true, result }), error => respond({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
  if (sender.id === chrome.runtime.id && typeof sender.tab?.id === 'number' &&
      (sender.frameId ?? 0) > 0 && sender.url?.split('?')[0] === chrome.runtime.getURL('src/overlay/index.html') &&
      message?.type === 'ktv420:overlay-request') {
    void request(message.request, sender.tab.id, undefined, sender.documentId).then(
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
      case 'ktv420:page-ready':
        if (sender.documentId) await recoverCaptureDocument(tabId, sender.documentId);
        return;
      case 'ktv420:cached':
        return (await pendingCaptures()).map((c) => c.metadata);
      case 'ktv420:capture-begin':
        return beginCapture(tabId, message.metadata, message.bytes, sender.documentId);
      case 'ktv420:capture-chunk':
        return appendCapture(tabId, message.id, message.index, message.base64);
      case 'ktv420:capture-finish':
        await finishCapture(tabId, message.id); await ensureWorkerHost(); return;
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
  if (sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
  const handle = async () => {
    return request(message, undefined, sender.tab?.id, sender.documentId);
  };
  void handle().then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true;
});

chrome.runtime.onStartup?.addListener(() => { void ensureWorkerHost().catch(() => {}); });
chrome.runtime.onInstalled?.addListener(() => { void ensureWorkerHost().catch(() => {}); });

chrome.tabs.onRemoved?.addListener(() => { void chrome.tabs.query({}).then(tabs => recoverQueue(new Set(tabs.flatMap(t => t.id === undefined ? [] : [t.id])))).catch(() => {}); });

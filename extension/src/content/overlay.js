import { isSupportedRoute } from './dom.js';

export function createOverlay({ onClose }) {
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  let frame, ready = false, open = false, route = '', lastUrl = '', previousOverflow = '';
  let originalTitle = '', overlayTitle = 'ktv420', favicons = [];
  // Spotify updates its title on track changes. Keep the hosted title while open.
  const applyTitle = () => { if (open && document.title !== overlayTitle) document.title = overlayTitle; };
  const titleObserver = new MutationObserver(applyTitle);
  const index = () => {
    const value = new URLSearchParams(location.search).get('ktv420');
    return /^[1-9]\d{0,4}$/.test(value || '') && Number(value) <= 10000 ? Number(value) : null;
  };
  function post() {
    if (ready && frame?.isConnected) frame.contentWindow.postMessage({ source: 'ktv420-spotify-host', type: 'navigation', open, trackIndex: index() }, origin);
  }
  function write(opened, trackIndex, replace = false) {
    const url = new URL(location.href);
    url.searchParams.delete('ktv420');
    if (opened) url.searchParams.set('ktv420', trackIndex === null ? '' : String(trackIndex));
    if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
    lastUrl = location.href;
  }
  function show(updateUrl = true) {
    if (!document.body || !isSupportedRoute()) return;
    if (!frame || route !== location.pathname) {
      frame?.remove(); ready = false; route = location.pathname;
      frame = document.createElement('iframe');
      frame.id = 'ktv420-spotify-overlay';
      frame.title = 'ktv420'; frame.allow = 'autoplay';
      Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0', zIndex: '2147483647', background: '#100c09', colorScheme: 'dark' });
      const url = new URL(chrome.runtime.getURL('src/overlay/index.html'));
      url.searchParams.set('id', route.slice(1).replace(/\/$/, '').replace('/', '.'));
      if (index() !== null) url.searchParams.set('ktv420', String(index()));
      frame.src = url.href;
      document.body.append(frame);
    }
    if (!open) {
      previousOverflow = document.documentElement.style.overflow;
      originalTitle = document.title;
      overlayTitle = 'ktv420';
      if (document.head) titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
      favicons = [...document.querySelectorAll('link[rel~="icon"]')].map(link => [link, link.getAttribute('href')]);
      for (const [link] of favicons) link.href = chrome.runtime.getURL('assets/favicon.svg');
    }
    open = true; applyTitle(); frame.hidden = false; document.documentElement.style.overflow = 'hidden';
    if (updateUrl) write(true, index());
    post(); frame.focus();
  }
  function hide(updateUrl = true) {
    if (!open) return;
    open = false; titleObserver.disconnect(); post(); frame.hidden = true;
    document.documentElement.style.overflow = previousOverflow;
    document.title = originalTitle;
    for (const [link, href] of favicons) { if (href === null) link.removeAttribute('href'); else link.setAttribute('href', href); }
    if (updateUrl) write(false, null);
    void onClose();
  }
  window.addEventListener('message', event => {
    if (event.source !== frame?.contentWindow || event.origin !== origin || event.data?.source !== 'ktv420-extension-host' || event.data.type !== 'ready') return;
    ready = true; post();
  });
  window.addEventListener('keydown', event => {
    if (open && event.key === 'Escape') { event.preventDefault(); hide(); }
  });
  const sync = () => {
    if (location.href === lastUrl || !document.body) return;
    lastUrl = location.href;
    if (open && location.pathname !== route) hide(false);
    if (isSupportedRoute() && new URLSearchParams(location.search).has('ktv420')) show(false);
    else hide(false);
  };
  window.addEventListener('popstate', sync);
  setInterval(sync, 300);
  return { show, hide,
    setView(trackIndex, replace) { write(true, trackIndex, replace); },
    setTitle(title) { if (open) { overlayTitle = title; applyTitle(); } },
  };
}

const supported = /^\/(?:playlist|album)\/[A-Za-z0-9]{22}\/?$/;
export function readOverlayUrl(href) {
  const url = new URL(href);
  const value = url.searchParams.get('ktv420');
  const open = supported.test(url.pathname) && value !== null;
  const index = open && /^[1-9]\d{0,4}$/.test(value || '') && Number(value) <= 10000 ? Number(value) : null;
  return { open, trackIndex: index, key: `${url.pathname}|${open ? index ?? '' : 'closed'}` };
}
export function writeOverlayUrl(href, open, trackIndex = null) {
  const url = new URL(href);
  url.searchParams.delete('ktv420');
  if (open) url.searchParams.set('ktv420', Number.isSafeInteger(trackIndex) && trackIndex > 0 && trackIndex <= 10000 ? String(trackIndex) : '');
  // Bare presence is the collection URL; preserve all other parameters and hash.
  return url.href.replace(/([?&])ktv420=(?=&|#|$)/, '$1ktv420');
}

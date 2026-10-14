import { collectTrackRows, extractTrackIdFromHref, dispatchSyntheticDoubleClick } from './dom.js';

const control = name => document.querySelector(`[data-testid="control-button-${name}"]`);
const ranges = () => [...document.querySelectorAll('[data-testid="now-playing-bar"] input[type="range"]')];
const slider = volume => ranges().find(e => volume ? Number(e.max) === 1 : Number(e.max) > 1);
const time = value => {
  const match = value?.match(/^(\d+):(\d{2})(?::(\d{2}))?/);
  return match ? match[3] === undefined ? Number(match[1]) * 60 + Number(match[2]) : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
};
const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
export function readTransportDom() {
  const widget = document.querySelector('[data-testid="now-playing-widget"]');
  const title = text('[data-testid="context-item-info-title"]');
  const artist = text('[data-testid="context-item-info-subtitles"]');
  const candidates = new Set();
  for (const a of document.querySelectorAll('[data-testid="now-playing-widget"] a, #Desktop_PanelContainer_Id a')) {
    const url = new URL(a.getAttribute('href') || '', location.origin);
    const uri = url.searchParams.get('uri');
    const id = uri?.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1] || extractTrackIdFromHref(url.href);
    // Sidebar may include recommendations: only its context URI is authoritative.
    if (id && (widget?.contains(a) || uri)) candidates.add(id);
  }
  const seek = slider(false), volume = slider(true), button = control('playpause');
  return {
    trackId: candidates.size === 1 ? [...candidates][0] : '', title, artist,
    artwork: widget?.querySelector('img')?.src || '',
    playing: /pause/i.test(button?.getAttribute('aria-label') || ''),
    position: seek ? time(seek.getAttribute('aria-valuetext')) ?? Number(seek.value) / 1000 : 0, duration: seek ? Number(seek.max) / 1000 : 0,
    volume: volume ? Number(volume.value) : null,
    available: !!button && !button.disabled && !!seek,
    canNext: !!control('skip-forward') && !control('skip-forward').disabled,
    canPrevious: !!control('skip-back') && !control('skip-back').disabled,
  };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function verify(predicate, message) {
  for (let i = 0; i < 20; i++) { if (predicate()) return; await delay(100); }
  throw new Error(message);
}
function setRange(input, value) {
  if (!input || input.disabled) throw new Error('Spotify slider is unavailable.');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  // Spotify's range step is for keyboard navigation; do not round precise seeks
  // or volume requests to five seconds / ten percent.
  input.step = 'any';
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
export async function commandTransport(command) {
  const before = readTransportDom();
  if (!before.available) throw new Error('Spotify playback controls are unavailable.');
  if (command.action === 'volume') {
    setRange(slider(true), command.volume); await delay(150);
    await verify(() => Math.abs((readTransportDom().volume ?? -1) - command.volume) < .02, 'Spotify did not accept the volume change.');
  } else if (command.action === 'play' || command.action === 'pause') {
    const playing = command.action === 'play';
    if (before.playing !== playing) control('playpause').click();
    await verify(() => readTransportDom().playing === playing, 'Spotify did not change playback state.');
  } else if (command.action === 'next' || command.action === 'previous') {
    const button = control(command.action === 'next' ? 'skip-forward' : 'skip-back');
    if (!button || button.disabled) throw new Error('Spotify track navigation is unavailable.');
    button.click();
    await verify(() => { const now = readTransportDom(); return now.trackId !== before.trackId || now.position < before.position - 1; }, 'Spotify did not change tracks or restart the song.');
  } else if (command.action === 'seek') {
    if (command.trackId !== before.trackId) throw new Error('The song changed before seeking.');
    const position = Math.min(before.duration, Math.max(0, command.position));
    setRange(slider(false), position * 1000);
    await delay(150);
    await verify(() => Math.abs(readTransportDom().position - position) < 1.5, 'Spotify did not accept the seek.');
  } else if (command.action === 'select') {
    if (before.trackId === command.trackId) return commandTransport({ action: 'play' });
    const row = collectTrackRows().find(item => item.trackId === command.trackId);
    if (!row) throw new Error('Open the song’s Spotify playlist to select it.');
    dispatchSyntheticDoubleClick(row.row);
    await verify(() => readTransportDom().trackId === command.trackId, 'Spotify did not select that song.');
  } else throw new Error('Unsupported Spotify control.');
}

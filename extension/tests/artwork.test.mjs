import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectTrackRows } from '../src/content/dom.js';

test('album rows share the header cover, playlists keep individual covers, and equalizers are ignored', t => {
  const cover = 'https://i.scdn.co/image/album-cover';
  const large = 'https://i.scdn.co/image/album-cover-large';
  const rowCover = 'https://i.scdn.co/image/other-cover';
  const img = (src, width, srcset = '') => ({ src, width, height: width, getAttribute: () => srcset });
  const row = images => ({ querySelector: () => ({ getAttribute: () => '/track/5EGTNEoUpibGgMWf6ECe0X', textContent: 'Song' }),
    querySelectorAll: selector => selector === 'img' ? images : [] });
  const rows = [row([]), row([img('https://open.spotifycdn.com/equalizer.gif', 14)]), row([img(rowCover, 64)])];
  const header = { querySelectorAll: () => [img(cover, 192, `${cover} 300w, ${large} 640w`), img('https://i.scdn.co/image/artist', 24)] };
  for (const [key, value] of Object.entries({
    window: { location: { pathname: '/album/example', origin: 'https://open.spotify.com' } },
    document: { querySelector: selector => selector.includes('entity-header') ? header : { querySelectorAll: () => rows } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  assert.deepEqual(collectTrackRows().map(track => track.trackArtworkSrc), [large, large, large]);
  rows[0].getAttribute = name => name === 'aria-rowindex' ? '52' : null;
  assert.equal(collectTrackRows()[0].rowIndex, 50, 'virtualized rows retain the absolute song index');
  window.location.pathname = '/playlist/example';
  assert.deepEqual(collectTrackRows().map(track => track.trackArtworkSrc), ['', '', rowCover]);
});

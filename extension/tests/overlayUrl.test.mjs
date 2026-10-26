import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOverlayUrl, writeOverlayUrl } from '../src/content/overlayUrl.js';
const base = 'https://open.spotify.com/album/3l2Gi0hMjZV2uvKoWlFkoQ';
test('presence opens a collection, positive one-based integers select tracks, malformed values never select a different song', () => {
  assert.equal(readOverlayUrl(base).open, false);
  for (const value of ['', '=no', '=-1', '=0', '=01', '=1.5', '=10001', '=99999999999999999999']) {
    assert.deepEqual(readOverlayUrl(`${base}?ktv420${value}`), {open:true,trackIndex:null,key:'/album/3l2Gi0hMjZV2uvKoWlFkoQ|'});
  }
  assert.equal(readOverlayUrl(`${base}?ktv420=1`).trackIndex, 1);
  assert.equal(readOverlayUrl(`${base}?ktv420=10000`).trackIndex, 10000);
  assert.equal(readOverlayUrl('https://open.spotify.com/search?ktv420=1').open, false);
});
test('URL changes preserve Spotify parameters/hash, remove duplicate ktv420 keys, and use bare presence for collections', () => {
  const href = `${base}?si=one&ktv420=3&ktv420=9&foo=a%20b#position`;
  assert.equal(writeOverlayUrl(href, true, 2), `${base}?si=one&foo=a+b&ktv420=2#position`);
  assert.equal(writeOverlayUrl(href, true), `${base}?si=one&foo=a+b&ktv420#position`);
  assert.equal(writeOverlayUrl(href, false), `${base}?si=one&foo=a+b#position`);
  assert.equal(readOverlayUrl(writeOverlayUrl(base, true, 1)).trackIndex, 1);
});

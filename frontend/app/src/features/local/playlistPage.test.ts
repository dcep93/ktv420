import test from 'node:test';
import assert from 'node:assert/strict';
import { playlistPath, playlistIndex, localPlaylistLink, localCatalogLink, playlistViewUrl } from './playlistPage';
test('standalone links validate collection kind and ID, preserving extension selection', () => {
  assert.equal(playlistPath('album.19cvoEE5d3pMkxLFL5TsAG'), 'album/19cvoEE5d3pMkxLFL5TsAG');
  assert.equal(playlistPath('playlist.4TrVrTU7ApdakGlWdRGxu3'), 'playlist/4TrVrTU7ApdakGlWdRGxu3');
  for (const id of [null,'album../bad','track.19cvoEE5d3pMkxLFL5TsAG','album.19cvoEE5d3pMkxLFL5TsAG/']) assert.equal(playlistPath(id), null);
  const extension='a'.repeat(32);
  assert.equal(localPlaylistLink('album/19cvoEE5d3pMkxLFL5TsAG',extension), `/playlist?id=album.19cvoEE5d3pMkxLFL5TsAG&extension=${extension}`);
  assert.equal(localCatalogLink(extension), `/catalog?extension=${extension}`);
  assert.equal(localCatalogLink('bad'), '/catalog');
});
test('track links are one-based and leave the collection identity intact', () => {
  for (const query of ['','?ktv420','?ktv420=0','?ktv420=-1','?ktv420=1.5','?ktv420=10001']) assert.equal(playlistIndex(query), null);
  assert.equal(playlistIndex('?id=x&ktv420=2'), 2);
  const href='https://ktv420.web.app/playlist?id=album.19cvoEE5d3pMkxLFL5TsAG&extension=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(playlistViewUrl(href,2), `${href}&ktv420=2`);
  assert.equal(playlistViewUrl(`${href}&ktv420=2`,null), href);
});

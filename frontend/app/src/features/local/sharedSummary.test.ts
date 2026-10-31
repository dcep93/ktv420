import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedSummary, playlistSummary } from './sharedSummary';
import type { LocalTrack } from './library';
import type { LibrarySummary } from '../../shared/librarySummary';
import { separationStatus } from './separationStatus';
import { HostedCaptureQueue } from './hostedCapture';

test('isolated overlay retains completed website tracks and skips recapturing them', async () => {
  const local = [{ id: 'spotify-oldSong', status: 'ready' }] as LocalTrack[];
  const remote: LibrarySummary[] = Array.from({ length: 10 }, (_, i) => ({ id: `spotify-song${i}`, status: 'ready', location: 'website' }));
  let reads = 0;
  const summary = await playlistSummary(true, true, async () => { reads++; return local; }, async () => remote);
  assert.equal(reads, 0, 'an overlay must not consult its isolated IndexedDB');
  assert.equal(summary.length, 10);
  assert.ok(summary.every(t => separationStatus(t, true).label === 'Ready'));
  const captured: string[] = [];
  await new HostedCaptureQueue().run(['song0', 'song1', 'missing'],
    () => new Set(summary.map(t => t.id.replace(/^spotify-/, ''))), async id => { captured.push(id); }, () => {});
  assert.deepEqual(captured, ['missing']);
});

test('overlay stays captured throughout separation, acknowledgement, refresh and later deletion', async () => {
  const id = 'spotify-newSong';
  const states: LibrarySummary[][] = [
    [{ id, status: 'captured', location: 'extension' }],
    [{ id, status: 'processing', location: 'extension', progress: { fraction: .4, message: 'Running segment 2' } }],
    [{ id, status: 'ready', location: 'website' }],
    [{ id, status: 'ready', location: 'website' }],
    [], // The canonical library removed this track; old overlay records cannot resurrect it.
  ];
  const labels: string[] = [];
  for (const remote of states) {
    const summary = await playlistSummary(true, true,
      async () => { throw new Error('Isolated audio database is unavailable'); }, async () => remote);
    labels.push(separationStatus(summary.find(t => t.id === id), true).label);
  }
  assert.deepEqual(labels, ['Queued', 'Separating · ~40%', 'Ready', 'Ready', 'Not captured']);
});

test('relay failures remain failures rather than presenting an empty or stale local library', async () => {
  await assert.rejects(playlistSummary(true, true, async () => [], async () => { throw new Error('Relay unavailable'); }), /Relay unavailable/);
});

test('top-level website still treats its own committed audio as authoritative', async () => {
  const local = [{ id: 'spotify-ready', status: 'ready' }] as LocalTrack[];
  const summary = await playlistSummary(false, true, async () => local,
    async () => [{ id: 'spotify-ready', status: 'processing', location: 'extension' }]);
  assert.equal(summary[0].status, 'ready');
});
test('durable shared readiness wins over stale active claims; deleted website summaries are ignored', () => {
  const ready = { id: 'spotify-ready', status: 'ready' } as LocalTrack;
  assert.deepEqual(sharedSummary([ready], [
    { id: ready.id, status: 'processing', location: 'extension' },
    { id: 'spotify-deleted', status: 'ready', location: 'website' },
    { id: 'spotify-new', status: 'processing', location: 'extension', progress: { fraction: .3, message: 'Separating' } },
  ]), [
    { ...ready, error: undefined, location: 'shared' },
    { id: 'spotify-new', status: 'processing', location: 'shared', progress: { fraction: .3, message: 'Separating' } },
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedSummary } from './sharedSummary';
import type { LocalTrack } from './library';
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

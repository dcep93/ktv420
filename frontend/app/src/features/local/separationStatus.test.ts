import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separationStatus, separationPhase } from './separationStatus';
import { parseLibrarySummary } from '../../shared/librarySummary';

test('website pause takes precedence over the overlay toggle and stale processing never spins', () => {
  const track = { id: 'spotify-song', status: 'processing' as const, location: 'website' as const, separation: 'paused' as const, updatedAt: 10000 };
  assert.equal(separationStatus(track, true, '', 11000).label, 'Paused in ktv420');
  assert.equal(separationStatus(track, true, '', 11000).busy, false);
  assert.equal(separationStatus({ ...track, separation: 'processing' }, false, '', 11000).busy, true);
  const stale = separationStatus({ ...track, separation: 'processing' }, true, '', 26000);
  assert.equal(stale.label, 'Open ktv420 to continue');
  assert.equal(stale.busy, false);
  assert.equal(separationStatus({ ...track, status: 'ready' }, false, '', 26000).label, 'Ready');
});
test('local queue, pause, retry and older extension states are distinct', () => {
  const track = { id: 'spotify-song', status: 'captured' as const, location: 'extension' as const };
  assert.equal(separationStatus(track, true).label, 'Queued for separation');
  assert.equal(separationStatus(track, false).label, 'Separation paused');
  assert.equal(separationStatus(track, true, 'GPU failed').label, 'Needs retry');
  assert.equal(separationStatus(track, true, 'GPU failed').detail, 'GPU failed');
  assert.equal(separationStatus({ ...track, location: undefined }, true).label, 'Captured · open ktv420');
  assert.equal(separationStatus(undefined, true).label, 'Not captured');
  assert.equal(separationPhase({ phase: 'restoring', fraction: .5, message: '' }), 'Restoring audio');
});
test('website summary validates optional state, strips caller timestamps and location', () => {
  assert.deepEqual(parseLibrarySummary([{ id: 'spotify-song', status: 'captured', separation: 'paused', updatedAt: 99999, location: 'extension' }]),
    [{ id: 'spotify-song', status: 'captured', separation: 'paused' }]);
  assert.throws(() => parseLibrarySummary([{ id: 'spotify-song', status: 'captured', separation: 'whatever' }]), /Invalid library summary/);
});

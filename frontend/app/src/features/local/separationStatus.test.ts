import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separationStatus, separationPhase, separationProgressLabel } from './separationStatus';
import { progressActivity } from './spotify/progressActivity';
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
  assert.equal(separationStatus(track, true).label, 'Queued');
  assert.equal(separationStatus(track, false).label, 'Separation paused');
  assert.equal(separationStatus(track, true, 'GPU failed').label, 'Needs retry');
  assert.equal(separationStatus(track, true, 'GPU failed').detail, 'GPU failed');
  assert.equal(separationStatus({ ...track, location: undefined }, true).label, 'Captured · open ktv420');
  assert.equal(separationStatus(undefined, true).label, 'Not captured');
  assert.equal(separationPhase({ phase: 'restoring', fraction: .5, message: '' }), 'Restoring audio');
});
test('visible separation status names the real operation and has only one percentage', () => {
  for (const message of ['Preparing audio: 50%', 'Restoring vocals: 50%']) {
    const label = separationProgressLabel(message, .15);
    assert.equal((label.match(/%/g) || []).length, 1);
    assert.ok(label.endsWith('~15%'));
    assert.ok(!label.includes('50%'));
  }
  assert.equal(separationProgressLabel('Initializing GPU model…', null), 'Initializing GPU model…');
  assert.equal(separationProgressLabel('Downloading model (50%)', null), 'Downloading model (50%)');
  const status = separationStatus({ id: 'spotify-song', status: 'processing', location: 'extension',
    progress: { fraction: .76, message: 'Running GPU model · segment 50 of 53' } }, true);
  assert.equal(status.label, 'Separating · ~76%');
});
test('a silent operation explicitly waits without inventing progress or a new stage', () => {
  const progress = { phase: 'loading' as const, fraction: 0, message: 'Initializing GPU model…' };
  assert.equal(progressActivity(progress, 1000, 15999), progress);
  const waiting = progressActivity(progress, 1000, 21000);
  assert.equal(waiting.message, 'Initializing GPU model… · no new progress for 20s');
  assert.equal(waiting.fraction, progress.fraction);
  assert.equal(waiting.phase, progress.phase);
  assert.equal(progress.message, 'Initializing GPU model…');
});
test('website summary validates optional state, strips caller timestamps and location', () => {
  assert.deepEqual(parseLibrarySummary([{ id: 'spotify-song', status: 'captured', separation: 'paused', updatedAt: 99999, location: 'extension' }]),
    [{ id: 'spotify-song', status: 'captured', separation: 'paused' }]);
  assert.throws(() => parseLibrarySummary([{ id: 'spotify-song', status: 'captured', separation: 'whatever' }]), /Invalid library summary/);
});

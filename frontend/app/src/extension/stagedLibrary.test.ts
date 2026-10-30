import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueTransaction, beginCapture, appendCapture, finishCapture, publishLibrarySummary, readLibrarySummary, pendingCaptures } from './queue';
import { listStagedAudio, deleteStagedAudio } from './stagedLibrary';
import { claimCapture, releaseClaim, preparedChunk, acknowledgePrepared } from './staging';
import { parseRequest } from './protocol';

async function raw(title: string, complete = true) {
  const id = await beginCapture(17, { trackId: title, trackName: title, audioSampleRate: 44100, audioChannelCount: 2,
    audioSampleFormat: 'PCM_F32LE', audioByteLength: 16, captureStartVerified: true, captureEndVerified: true }, 16);
  await appendCapture(17, id, 0, btoa('\0'.repeat(16)));
  if (complete) await finishCapture(17, id);
  return id;
}
async function values(store: string) {
  return queueTransaction<unknown[]>([store], 'readonly', (tx, done) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => done(r.result); });
}
test('settings list raw/prepared sizes and delete selected extension data without touching website metadata or newer captures', async () => {
  const id = await raw('rawsong'), other = await raw('retainedsong'), preparedId = crypto.randomUUID();
  await publishLibrarySummary([{ id: 'spotify-rawsong', status: 'ready' }]);
  await queueTransaction(['prepared', 'preparedFiles', 'uploads', 'chunks'], 'readwrite', tx => {
    tx.objectStore('prepared').put({ id: preparedId, capture: { id: preparedId, metadata: { trackName: 'Prepared song' } }, files: [{ name: 'input', bytes: 10 }, { name: 'drums', bytes: 20 }] });
    tx.objectStore('preparedFiles').put({ id: `${preparedId}/input`, blob: new Blob(['1234567890']) });
    tx.objectStore('preparedFiles').put({ id: `${preparedId}/drums`, blob: new Blob(['12345678901234567890']) });
    tx.objectStore('uploads').put({ id, offsets: { input: 1 }, manifest: { files: [{ name: 'input', bytes: 12 }] } });
    tx.objectStore('chunks').put({ key: `output/${id}/input/0`, captureId: `output/${id}`, blob: new Blob(['partial-data']) });
  });
  const rows = await listStagedAudio();
  assert.deepEqual(rows.find(r => r.id === id), { id, title: 'rawsong', bytes: 28, ready: false, busy: false });
  assert.deepEqual(rows.find(r => r.id === preparedId), { id: preparedId, title: 'Prepared song', bytes: 30, ready: true, busy: false });
  await deleteStagedAudio([id, preparedId]);
  assert.ok((await pendingCaptures()).some(c => c.id === other));
  assert.equal((await listStagedAudio()).some(r => r.id === id || r.id === preparedId), false);
  assert.equal((await values('uploads')).length, 0);
  assert.equal((await values('preparedFiles')).length, 0);
  assert.equal((await values('chunks')).length, 1); // retained recording only
  assert.ok((await readLibrarySummary()).some(r => r.id === 'spotify-rawsong' && r.status === 'ready'));
  await deleteStagedAudio([id, preparedId]); // Safe if a transfer acknowledgement won the race.
  await deleteStagedAudio([other]);
});
test('deletion atomically rejects the whole selection when a worker or receiver claims a song after confirmation', async () => {
  const first = await raw('first'), busy = await raw('busy');
  for (const owner of [17, 'website'] as const) {
    const token = await claimCapture(busy, owner);
    assert.ok(token);
    assert.equal((await listStagedAudio()).find(r => r.id === busy)?.busy, true);
    await assert.rejects(deleteStagedAudio([first, busy]), /processed or transferred/);
    assert.ok((await pendingCaptures()).some(c => c.id === first));
    await releaseClaim(busy, token, owner);
  }
  await deleteStagedAudio([first, busy]);
  assert.equal(await claimCapture(busy, 17), null); // An old worker cannot resurrect it.
  const unfinished = await raw('unfinished', false);
  await assert.rejects(deleteStagedAudio([unfinished]), /processed or transferred/);
  await finishCapture(17, unfinished);
  await deleteStagedAudio([unfinished]);
});
test('prepared transfer is protected until acknowledgement or lease expiry', async () => {
  const id = crypto.randomUUID();
  await queueTransaction(['prepared', 'preparedFiles'], 'readwrite', tx => {
    tx.objectStore('prepared').put({ id, capture: { id, metadata: { trackId: 'prepared', trackName: 'Prepared' } }, files: [{ name: 'input', bytes: 10 }] });
    tx.objectStore('preparedFiles').put({ id: `${id}/input`, blob: new Blob(['0123456789']) });
  });
  await preparedChunk(id, 'input', 0);
  await assert.rejects(deleteStagedAudio([id]), /processed or transferred/);
  await acknowledgePrepared(id);
  assert.equal((await values('claims')).length, 0);
  assert.equal((await values('preparedFiles')).length, 0);
  const rawId = await raw('expired');
  await queueTransaction(['claims'], 'readwrite', tx => { tx.objectStore('claims').put({ id: rawId, expires: 1 }); });
  await deleteStagedAudio([rawId]);
});
test('delete protocol requires bounded explicit recording IDs rather than a blanket wipe', () => {
  const r = { protocol: 'ktv420-spotify', version: 1, operation: 'staging-delete' };
  for (const ids of [undefined, [], ['all'], [null], Array(10001).fill(crypto.randomUUID())]) assert.throws(() => parseRequest({ ...r, ids }), /Invalid staging deletion/);
  const ids = [crypto.randomUUID()];
  assert.deepEqual(parseRequest({ ...r, ids }).ids, ids);
});

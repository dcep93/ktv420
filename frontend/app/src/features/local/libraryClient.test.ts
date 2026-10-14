import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryClient } from './libraryClient';

test('client preserves Blob responses and correlates replies without accepting unknown ids', async () => {
  let receive: (data: never) => void = () => {};
  const sent: {id: string; method: string}[] = [];
  const client = createLibraryClient({ send: data => sent.push(data as typeof sent[number]), subscribe: callback => { receive = callback; return () => {}; } });
  const request = client.request<Blob>('getInput', ['track']);
  receive({ source: 'ktv420-library', version: 2, id: 'wrong', ok: true, result: 'bad' } as never);
  const bytes = new Float32Array([-0, 1.25, -1.25]);
  receive({ source: 'ktv420-library', version: 2, id: sent[0].id, ok: true, result: new Blob([bytes]) } as never);
  assert.deepEqual(new Uint8Array(await (await request).arrayBuffer()), new Uint8Array(bytes.buffer));
  client.dispose();
});
test('client rejects incompatible versions, timeout, disconnect and late use', async () => {
  let receive: (data: never) => void = () => {};
  let id = '';
  const client = createLibraryClient({ send: data => { id = (data as {id: string}).id; }, subscribe: callback => { receive = callback; return () => {}; } }, 10);
  const incompatible = client.request('listTracks');
  receive({ source: 'ktv420-library', version: 1, id, ok: true } as never);
  await assert.rejects(incompatible, /newer ktv420 extension/);
  await assert.rejects(client.request('listTracks'), /did not respond/);
  const disconnected = client.request('listTracks');
  client.dispose();
  await assert.rejects(disconnected, /closed/);
  await assert.rejects(client.request('listTracks'), /closed/);
});
test('a reloaded client cannot accept a delayed response from the previous document', async () => {
  let receive: (data: never) => void = () => {};
  const ids: string[] = [];
  const transport = { send: (data: unknown) => { ids.push((data as {id: string}).id); }, subscribe: (callback: typeof receive) => { receive = callback; return () => {}; } };
  const first = createLibraryClient(transport);
  const previous = first.request('listTracks');
  first.dispose();
  await assert.rejects(previous, /closed/);
  const next = createLibraryClient(transport);
  const current = next.request('listTracks');
  assert.notEqual(ids[0], ids[1]);
  receive({ source: 'ktv420-library', version: 2, id: ids[0], ok: true, result: 'stale' } as never);
  receive({ source: 'ktv420-library', version: 2, id: ids[1], ok: true, result: 'current' } as never);
  assert.equal(await current, 'current');
  next.dispose();
});

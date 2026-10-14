import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest, writeAssetManifest, retainPlayerAssets } from './player-assets.mjs';
const descriptor = (path, value) => ({ path, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') });

test('retains earlier worker/runtime bytes so old pages survive subsequent deploys', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ktv420-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets')); await mkdir(join(root, 'ort', '2.0.0'), {recursive:true});
  await writeFile(join(root, 'assets', 'worker-new.js'), 'new');
  await writeFile(join(root, 'ort', '2.0.0', 'runtime.wasm'), 'new-runtime');
  await writeAssetManifest(root);
  const previous = { version: 1, files: [descriptor('assets/worker-old.js', 'old'), descriptor('ort/1.0.0/runtime.wasm', 'old-runtime')] };
  await retainPlayerAssets(root, 'https://example.com/player/', async url => {
    if (url.pathname.endsWith('assets-manifest.json')) return new Response(JSON.stringify(previous));
    return new Response(url.pathname.endsWith('worker-old.js') ? 'old' : 'old-runtime');
  });
  assert.equal(await readFile(join(root, 'ort/1.0.0/runtime.wasm'), 'utf8'), 'old-runtime');
  assert.equal(JSON.parse(await readFile(join(root, 'assets-manifest.json'), 'utf8')).files.length, 4);
  await assert.rejects(retainPlayerAssets(root, 'https://example.com/player/', async () => new Response(JSON.stringify({ version:1, files:[descriptor('assets/worker-new.js','changed')] }))), /Immutable asset changed/);
});

test('asset manifest rejects traversal and deployment refuses a corrupt retained file', async t => {
  for (const path of ['ort/../escape', '../escape', 'assets/../escape', 'assets//escape']) {
    assert.throws(() => validateManifest({version:1,files:[descriptor(path,'bad')]}));
  }
  const root = await mkdtemp(join(tmpdir(), 'ktv420-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify({version:1, files:[]}));
  await assert.rejects(retainPlayerAssets(root, 'https://example.com/player/', async url => new Response(url.pathname.endsWith('.json')
    ? JSON.stringify({version:1,files:[descriptor('assets/worker-old.js','original')]}) : 'corrupt')), /integrity failed/);
  await assert.rejects(retainPlayerAssets(root, 'https://example.com/player/', async () => new Response('unavailable',{status:503})), /HTTP 503/);
});

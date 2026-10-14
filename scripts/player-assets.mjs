import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateManifest(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.files) || value.files.length > 100000) throw new Error('Invalid player asset manifest.');
  const seen = new Set();
  for (const file of value.files) {
    if (!file || typeof file.path !== 'string' || !/^(assets\/[\w.-]+|ort\/[\w.-]+\/[\w.-]+)$/.test(file.path) ||
      file.path.split('/').some(part => part === '.' || part === '..') || seen.has(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 200 * 1024 * 1024) throw new Error('Invalid retained player asset.');
    seen.add(file.path);
  }
  return value;
}
export async function writeAssetManifest(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else { const bytes = await readFile(join(root, path)); files.push({ path, bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  await walk('assets'); await walk('ort');
  const manifest = validateManifest({ version: 1, files: files.sort((a,b) => a.path.localeCompare(b.path)) });
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
}

/** Keep immutable code dependencies for open sessions; never retains user audio. */
export async function retainPlayerAssets(root, base, fetcher = fetch) {
  const current = validateManifest(JSON.parse(await readFile(join(root, 'assets-manifest.json'), 'utf8')));
  const response = await fetcher(new URL('assets-manifest.json', base), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cannot inspect previously published player assets (HTTP ${response.status}).`);
  const body = await response.text();
  // First migration only: the existing installation-only site rewrites unknown paths to its guide.
  if (body.includes('<title>ktv420 — your music, pulled apart</title>')) return;
  const previous = validateManifest(JSON.parse(body));
  const merged = new Map(current.files.map(file => [file.path, file]));
  for (const file of previous.files) {
    const existing = merged.get(file.path);
    if (existing) {
      if (existing.sha256 !== file.sha256 || existing.bytes !== file.bytes) throw new Error(`Immutable asset changed: ${file.path}`);
      continue;
    }
    const download = await fetcher(new URL(file.path, base));
    if (!download.ok) throw new Error(`Cannot retain ${file.path}: HTTP ${download.status}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`Retained asset integrity failed: ${file.path}`);
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), bytes);
    merged.set(file.path, file);
  }
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify({ version: 1, files: [...merged.values()].sort((a,b) => a.path.localeCompare(b.path)) }));
}

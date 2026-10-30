import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('extension requests only offscreen processing permission and limits site access to Spotify', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions ?? [], ['offscreen']);
  assert.deepEqual(manifest.optional_permissions ?? [], []);
  assert.deepEqual(manifest.host_permissions, ['https://open.spotify.com/*', 'https://ktv420.web.app/*']);
  assert.deepEqual(manifest.content_scripts.flatMap(script => script.matches), ['https://open.spotify.com/*']);
  assert.deepEqual(manifest.externally_connectable.matches, ['https://ktv420.web.app/*']);
});

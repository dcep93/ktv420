import { cp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeAssetManifest } from './player-assets.mjs';
const root = new URL('../', import.meta.url);
// Never replace a working install with a broker for an unpublished website.
const output = new URL('dist/extension-candidate/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const directory of ['src', 'assets']) {
  await cp(new URL(`extension/${directory}/`, root), new URL(`${directory}/`, output), { recursive: true });
}
const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
manifest.description = 'Capture Spotify and keep audio locally. The ktv420 hosted player handles listening, DJing and local separation.';
manifest.host_permissions = ['https://open.spotify.com/*'];
manifest.content_security_policy.extension_pages = "script-src 'self'; object-src 'none'; frame-src https://ktv420.web.app; connect-src 'none'; img-src 'self';";
delete manifest.cross_origin_embedder_policy;
delete manifest.cross_origin_opener_policy;
await writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(new URL('frontend/app/dist-extension/', root), new URL('build/', output), { recursive: true });
await rename(new URL('build/broker.html', output), new URL('build/index.html', output));
await cp(new URL('THIRD_PARTY_NOTICES.md', root), new URL('THIRD_PARTY_NOTICES.md', output));
const hosted = new URL('site/player/', root);
await rm(hosted, { recursive: true, force: true });
await cp(new URL('frontend/app/dist/', root), hosted, { recursive: true });
await rm(new URL('benchmark-reference.f32', hosted), { force: true });
await writeAssetManifest(hosted.pathname);
const theme = new URL('site/theme/', root);
await rm(theme, { recursive: true, force: true });
await cp(new URL('frontend/app/src/styles/', root), theme, { recursive: true });
const zip = new URL('dist/ktv420-extension.zip', root);
await rm(zip, { force: true });
execFileSync('zip', ['-qr', zip.pathname, 'manifest.json', 'src', 'assets', 'build', 'THIRD_PARTY_NOTICES.md'], { cwd: output });
const hash = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(new URL('dist/ktv420-extension.zip.sha256', root), `${hash}  ktv420-extension.zip\n`);
if (process.argv.includes('--install')) {
  // Run only after /player/ is published. Keep the same path and extension ID/storage.
  const installed = new URL('extension/', root);
  await rm(new URL('build/', installed), { recursive: true, force: true });
  await cp(new URL('build/', output), new URL('build/', installed), { recursive: true });
  await cp(new URL('manifest.json', output), new URL('manifest.json', installed));
}
console.log(`Candidate: ${output.pathname}\nHosted player: ${hosted.pathname}\nZIP: ${zip.pathname}\nSHA256 ${hash}\nInstalled extension/build preserved unless --install was specified.`);

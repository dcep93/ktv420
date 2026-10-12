import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const output = new URL('extension/', root);
const build = new URL('build/', output);
// Preserve the installed extension path and its tracked capture sources.
await rm(build, {recursive:true,force:true});
await cp(new URL('frontend/app/dist/',root), build,{recursive:true});
await rm(new URL('benchmark-reference.f32', build), {force:true});
await cp(new URL('THIRD_PARTY_NOTICES.md', root), new URL('THIRD_PARTY_NOTICES.md', output));
await mkdir(new URL('dist/', root), {recursive:true});
await rm(new URL('dist/extension/', root), {recursive:true,force:true});
const zip = new URL('dist/ktv420-extension.zip',root);
await rm(zip,{force:true});
execFileSync('zip',['-qr',zip.pathname,'manifest.json','src','assets','build','THIRD_PARTY_NOTICES.md'],{cwd:output});
const hash = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(new URL('dist/ktv420-extension.zip.sha256',root),`${hash}  ktv420-extension.zip\n`);
console.log(`Load unpacked: ${output.pathname}\nBuilt ${zip.pathname}\nSHA256 ${hash}`);

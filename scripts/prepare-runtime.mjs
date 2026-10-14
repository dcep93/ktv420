import { mkdir, readdir, copyFile, readFile, rm } from 'node:fs/promises';
const source = new URL('../frontend/app/node_modules/onnxruntime-web/dist/', import.meta.url);
const runtime = JSON.parse(await readFile(new URL('../frontend/app/node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8'));
const parent = new URL('../frontend/app/public/ort/', import.meta.url);
await rm(parent, { recursive: true, force: true });
const target = new URL(`${runtime.version}/`, parent);
await mkdir(target, {recursive:true});
for (const name of await readdir(source)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(new URL(name, source), new URL(name, target));
}

import { mkdir, readdir, copyFile } from 'node:fs/promises';
const source = new URL('../frontend/app/node_modules/onnxruntime-web/dist/', import.meta.url);
const target = new URL('../frontend/app/public/ort/', import.meta.url);
await mkdir(target, {recursive:true});
for (const name of await readdir(source)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(new URL(name, source), new URL(name, target));
}

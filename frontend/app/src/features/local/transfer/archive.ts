import { BlobReader, ZipReader, ZipWriter, type Entry } from '@zip.js/zip.js';
import { MANIFEST, MAX_ENTRIES, MAX_MANIFEST, MAX_TOTAL, bundleAssets, parseBundle, safePath, type Asset, type Bundle } from './manifest';
export type PackageSource = { bundle: Bundle; read: (asset: Asset, signal: AbortSignal, progress?: (bytes:number)=>void) => Promise<Blob>; close: () => Promise<void> };
const ignored = (name:string) => name.split('/').some(part=>part==='__MACOSX' || part==='.DS_Store' || part.startsWith('._'));
function entriesCheck(entries: Map<string,number>, bundle: Bundle) {
  const expected = new Map(bundleAssets(bundle).map(asset=>[asset.path,asset.bytes]));
  expected.set(MANIFEST,entries.get(MANIFEST)!);
  for (const [path,size] of entries) if (!expected.has(path) || expected.get(path)!==size) throw new Error(`Unexpected file or size: ${path}`);
  for (const path of expected.keys()) if (!entries.has(path)) throw new Error(`Missing file: ${path}`);
}
function prefixFor(names:string[]) {
  const found = names.filter(name=>name===MANIFEST || name.endsWith(`/${MANIFEST}`));
  if (found.length !== 1) throw new Error('Select one ktv420 ZIP or the extracted playlist folder containing ktv420.json.');
  return found[0].slice(0,-MANIFEST.length);
}
async function boundedEntry(entry: Entry, maximum:number, signal:AbortSignal, progress?: (bytes:number)=>void): Promise<Blob> {
  if (entry.directory || entry.uncompressedSize>maximum || entry.encrypted) throw new Error('Invalid or oversized ZIP entry.');
  const chunks: Uint8Array<ArrayBuffer>[]=[]; let size=0;
  await entry.getData(new WritableStream<Uint8Array>({write(chunk){signal.throwIfAborted();size+=chunk.byteLength;if(size>maximum)throw new Error('ZIP entry exceeded its declared size.');chunks.push(Uint8Array.from(chunk));progress?.(size);}}),{signal,checkSignature:true,useWebWorkers:false,useCompressionStream:true});
  if (size !== entry.uncompressedSize) throw new Error('ZIP entry has an incorrect size.');
  return new Blob(chunks);
}
export async function openZip(file: Blob, signal: AbortSignal): Promise<PackageSource> {
  if (file.size>MAX_TOTAL+64*1024**2) throw new Error('ZIP exceeds the 64 GiB package limit.');
  const reader = new ZipReader(new BlobReader(file),{useWebWorkers:false});
  try {
    const all = new Map<string,Entry>(); let total=0,count=0;
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted(); if (++count>MAX_ENTRIES) throw new Error('Too many ZIP entries.');
      if (!safePath(entry.filename.replace(/\/$/,''))) throw new Error('Unsafe ZIP path.');
      if (ignored(entry.filename) || entry.directory) continue;
      if (all.has(entry.filename) || entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize)) throw new Error('Duplicate or invalid ZIP entry.');
      total+=entry.uncompressedSize;if(total>MAX_TOTAL+MAX_MANIFEST)throw new Error('Expanded ZIP is too large.');
      all.set(entry.filename,entry);
    }
    const prefix=prefixFor([...all.keys()]); const entries=new Map([...all].map(([path,entry])=>[path.startsWith(prefix)?path.slice(prefix.length):path,entry]));
    const manifest=entries.get(MANIFEST)!;
    const bundle=parseBundle(JSON.parse(await (await boundedEntry(manifest,MAX_MANIFEST,signal)).text()));
    entriesCheck(new Map([...entries].map(([path,entry])=>[path,entry.uncompressedSize])),bundle);
    return {bundle,read:(asset,abort,progress)=>boundedEntry(entries.get(asset.path)!,asset.bytes,abort,progress),close:()=>reader.close()};
  } catch(error) {await reader.close();throw error;}
}
export async function openFolder(files: File[], signal: AbortSignal): Promise<PackageSource> {
  if (files.length>MAX_ENTRIES) throw new Error('Too many files in folder.');
  const names=files.filter(file=>!ignored(file.webkitRelativePath || file.name)).map(file=>({file,path:file.webkitRelativePath || file.name}));
  const prefix=prefixFor(names.map(item=>item.path)), entries=new Map<string,File>();
  for (const {file,path} of names) {
    signal.throwIfAborted();
    if (!safePath(path) || !path.startsWith(prefix) || entries.has(path.slice(prefix.length))) throw new Error('Duplicate or unsafe folder path.');
    entries.set(path.slice(prefix.length),file);
  }
  const manifest=entries.get(MANIFEST)!;
  if (manifest.size>MAX_MANIFEST) throw new Error('Playlist manifest is too large.');
  const bundle=parseBundle(JSON.parse(await manifest.text()));
  entriesCheck(new Map([...entries].map(([path,file])=>[path,file.size])),bundle);
  return {bundle,async read(asset,abort,progress){abort.throwIfAborted();progress?.(asset.bytes);return entries.get(asset.path)!;},async close(){}};
}
export function archiveWriter(output: WritableStream<Uint8Array>) {
  // Sequential STORE entries go directly to the writable file; never collect the ZIP in a Blob.
  const writer=new ZipWriter(output,{level:0,bufferedWrite:false,useWebWorkers:false});
  return {add:(path:string,blob:Blob,signal:AbortSignal,progress?:(bytes:number)=>void)=>writer.add(path,new BlobReader(blob),{signal,onprogress:progress,level:0}),close:(signal:AbortSignal)=>{signal.throwIfAborted();return writer.close();}};
}

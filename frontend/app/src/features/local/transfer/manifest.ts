import { MP3_NAMES, mp3Layout, type Mp3Encoding } from '../audio/mp3Types';
import { parseCollection, type Collection } from '../savedCollections';
export const MANIFEST = 'ktv420.json';
export const MAX_AUDIO = 256 * 1024 ** 2, MAX_ART = 2 * 1024 ** 2, MAX_MANIFEST = 16 * 1024 ** 2;
export const MAX_TOTAL = 64 * 1024 ** 3, MAX_ENTRIES = 60001;
export type Asset = { path: string; bytes: number; sha256: string };
export type BundleTrack = {
  id: string; title: string; artist: string; sampleRate: number; frames: number;
  encoding: Mp3Encoding; crop: string; artworkUrl: string;
  files: Record<typeof MP3_NAMES[number], Asset>; artwork?: Asset; metadata?: Record<string, unknown>;
};
export type Bundle = { format: 'ktv420-playlist'; version: 2; collection: Collection; tracks: BundleTrack[] };
export function safePath(path: string) {
  return path.length <= 300 && !path.includes('\\') && !path.startsWith('/') && !path.includes(':') &&
    path.split('/').every(part => !!part && part !== '.' && part !== '..' && ![...part].some(character => character.charCodeAt(0) < 32));
}
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function string(v: unknown, max: number): v is string { return typeof v === 'string' && v.length <= max; }
export function artworkUrl(v: unknown): string { return typeof v === 'string' && /^https:\/\/(?:i|mosaic)\.scdn\.co\//.test(v) && v.length <= 4096 ? v : ''; }
export function parseBundle(value: unknown): Bundle {
  if (!object(value) || value.format !== 'ktv420-playlist' || value.version !== 2) throw new Error('Unsupported ktv420 package version.');
  const collection = parseCollection(value.collection);
  if (!collection || !Array.isArray(value.tracks) || value.tracks.length !== new Set(collection.trackIds).size || value.tracks.length > 10000) throw new Error('Invalid playlist membership.');
  let total = 0; const paths = new Set<string>();
  const asset = (v: unknown, expected: string, max: number): Asset => {
    if (!object(v) || v.path !== expected || !safePath(expected) || paths.has(expected) || !Number.isSafeInteger(v.bytes) || Number(v.bytes) <= 0 || Number(v.bytes) > max || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)) throw new Error(`Invalid package file: ${expected}`);
    paths.add(expected); total += Number(v.bytes);
    if (total > MAX_TOTAL) throw new Error('Package exceeds the 64 GiB limit.');
    return {path:expected,bytes:Number(v.bytes),sha256:v.sha256};
  };
  const tracks = value.tracks.map((v: unknown, index): BundleTrack => {
    const id = [...new Set(collection.trackIds)][index];
    if (!object(v) || v.id !== id || !string(v.title, 500) || !string(v.artist, 500) || !Number.isInteger(v.sampleRate) || Number(v.sampleRate) < 8000 || Number(v.sampleRate) > 192000 || !Number.isSafeInteger(v.frames) || Number(v.frames) <= 0 || Number(v.frames) * 4 > 1024 ** 3 || !object(v.encoding) || !object(v.files)) throw new Error(`Invalid song metadata at position ${index + 1}.`);
    const layout = mp3Layout(Number(v.sampleRate), Number(v.frames));
    if (v.encoding.sampleRate !== layout.sampleRate || v.encoding.frames !== layout.frames || typeof v.encoding.gain !== 'number' || !Number.isFinite(v.encoding.gain) || v.encoding.gain <= 0 || v.encoding.gain > 1 || !string(v.crop, 40) || !/^\d+(?:\.\d+)?-0$/.test(v.crop) || Number(v.crop.split('-')[0]) > 2) throw new Error('Invalid audio timing or gain.');
    if (Object.keys(v.files).length !== 5) throw new Error('Original and all four stems are required.');
    if (v.metadata !== undefined && (!object(v.metadata) || JSON.stringify(v.metadata).length > 65536)) throw new Error('Invalid song metadata.');
    const files = Object.fromEntries(MP3_NAMES.map(name => [name,asset((v.files as Record<string, unknown>)[name],`tracks/${id}/${name}.mp3`,MAX_AUDIO)])) as BundleTrack['files'];
    return {id,title:v.title,artist:v.artist,sampleRate:Number(v.sampleRate),frames:Number(v.frames),encoding:{...layout,gain:v.encoding.gain},crop:v.crop,artworkUrl:artworkUrl(v.artworkUrl),files,
      ...(v.metadata ? {metadata: v.metadata as Record<string,unknown>} : {}),
      ...(v.artwork ? {artwork:asset(v.artwork,`tracks/${id}/artwork`,MAX_ART)} : {})};
  });
  return {format:'ktv420-playlist',version:2,collection,tracks};
}
export const bundleAssets = (bundle: Bundle) => bundle.tracks.flatMap(track => [...MP3_NAMES.map(name=>track.files[name]), ...(track.artwork ? [track.artwork] : [])]);
export async function digest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyAsset(blob: Blob, asset: Asset) {
  if (blob.size !== asset.bytes || await digest(blob) !== asset.sha256) throw new Error(`Damaged or incorrect file: ${asset.path}`);
}
/** Allow only raster signatures. No SVG/HTML or executable content from imported artwork. */
export async function raster(blob: Blob): Promise<Blob> {
  if (blob.size > MAX_ART) throw new Error('Artwork exceeds 2 MiB.');
  const b = new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const type = b[0]===255 && b[1]===216 && b[2]===255 ? 'image/jpeg' :
    b[0]===137 && b[1]===80 && b[2]===78 && b[3]===71 ? 'image/png' :
    String.fromCharCode(...b.slice(0,4))==='RIFF' && String.fromCharCode(...b.slice(8,12))==='WEBP' ? 'image/webp' : '';
  if (!type) throw new Error('Unsupported artwork file.');
  return blob.slice(0,blob.size,type);
}

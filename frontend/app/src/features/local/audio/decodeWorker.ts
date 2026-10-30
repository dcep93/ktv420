import { decodeWav } from './wav';
self.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  try { const audio = decodeWav(data); self.postMessage({ audio }, { transfer: [audio.left.buffer, audio.right.buffer] }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};

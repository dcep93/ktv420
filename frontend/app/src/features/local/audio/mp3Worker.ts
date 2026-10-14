import { encodeMp3Set } from './mp3';
import type { Mp3Request } from './mp3Types';
self.onmessage = async ({ data }: MessageEvent<Mp3Request>) => {
  try {
    const result = await encodeMp3Set(data.input, data.stems, progress => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};

import { nextSeparationFraction } from '../rowProgress';
import { spotifyRequest } from './client';
import { processLocalTrack } from '../processing';
import { LocalSeparator } from '../inference/client';
import type { QueuedCapture } from '../../../shared/captureFormat';
import { CHUNK_BYTES, decodeChunk } from '../../../shared/captureFormat';
import { wavHeader } from '../../../shared/captureWav';
import { MP3_NAMES } from '../audio/mp3Types';
import { encodeBlobChunk, sha256, type PreparedAudio } from '../../../shared/preparedAudio';
import type { SeparationProgress } from '../inference/types';

/** No audio is stored in the hosted iframe's partitioned IndexedDB. */
type Worker = Pick<LocalSeparator, 'separateStereo' | 'dispose'>;
export function startStagedProcessing(onError: (error: string, trackId?: string) => void, onProgress: (id: string, progress: SeparationProgress | null) => void,
  dependencies: { request?: typeof spotifyRequest; createSeparator?: () => Worker; process?: typeof processLocalTrack } = {}) {
  const request = dependencies.request || spotifyRequest;
  const createSeparator = dependencies.createSeparator || (() => new LocalSeparator({ backend: queueBackend !== 'wasm' && 'gpu' in navigator ? 'webgpu' : 'wasm' }));
  const process = dependencies.process || processLocalTrack;
  let stopped = false, busy = false, separator: Worker | undefined, queueEnabled = true, pausedRun = false, sharedQueue = false, stateBusy = false;
  let overall: number | null = null, queueBackend: 'auto' | 'wasm' = 'auto';
  const readState = async () => {
    if (!sharedQueue || stateBusy || stopped) return;
    stateBusy = true;
    try { const state = await request<{ enabled: boolean; backend: 'auto' | 'wasm' }>('work-state'); queueEnabled = state.enabled; queueBackend = state.backend; if (!queueEnabled && separator) { pausedRun = true; separator.dispose(); } }
    catch (error) { if (!stopped) onError(String(error)); }
    finally { stateBusy = false; }
  };
  const attempted = new Set<string>();
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const capability = await request<{ stagedAudio?: boolean; extensionQueue?: boolean }>('hello');
      if (!capability.stagedAudio) return;
      sharedQueue = !!capability.extensionQueue;
      await readState();
      if (!queueEnabled) return;
      for (const capture of await request<QueuedCapture[]>('work-pending')) {
        if (stopped || !queueEnabled) break;
        if (capture.processingError || (!sharedQueue && attempted.has(capture.id))) continue;
        const token = await request<string | null>('work-claim', { id: capture.id });
        if (!token) continue;
        attempted.add(capture.id); overall = null; pausedRun = false;
        let lost = false, finishing = false, latest: SeparationProgress | null = null, touchedAt = Date.now(), renewing = false;
        const args = { id: capture.id, token };
        let worker: Worker | undefined;
        const renew = () => {
          if (renewing || stopped || lost || finishing) return;
          renewing = true; touchedAt = Date.now();
          void request('work-touch', { ...args, ...(latest ? { progress: { fraction: overall ?? 0, message: latest.message } } : {}) }).catch(error => {
            if (finishing) return;
            lost = true; worker?.dispose(); if (!stopped) onError(String(error), String(capture.metadata.trackId));
          }).finally(() => { renewing = false; });
        };
        const report = (progress: SeparationProgress) => {
          latest = progress; overall = nextSeparationFraction(overall, progress);
          onProgress(String(capture.metadata.trackId), progress);
          if (Date.now() - touchedAt > 2000) renew();
        };
        const heartbeat = setInterval(renew, 10000);
        try {
          worker = createSeparator(); separator = worker;
          await process(`spotify-${capture.metadata.trackId}`, separator, () => stopped || lost || pausedRun || !queueEnabled,
            report, {
              setTrackStatus: async () => {}, // The exclusive claim represents processing; final commit represents ready.
              getInput: async () => {
                report({ phase: 'loading', fraction: 0, message: 'Reading captured audio…' });
                const parts: Blob[] = []; let bytes = 0;
                for (let index = 0; index < capture.nextChunk; index++) {
                  if (stopped || lost || pausedRun || !queueEnabled) throw new Error('Separation paused.');
                  const chunk = decodeChunk(await request<string>('work-chunk', { ...args, index }));
                  parts.push(new Blob([chunk])); bytes += chunk.length;
                  report({ phase: 'loading', fraction: bytes / capture.expectedBytes, message: `Reading captured audio · ${Math.round(bytes / capture.expectedBytes * 100)}%` });
                }
                if (bytes !== capture.expectedBytes) throw new Error('Incomplete recording.');
                return new Blob([wavHeader(capture), ...parts], { type: 'audio/wav' });
              },
              saveMp3: async (_id, files, metadata, encoding) => {
                const blobs: { name: typeof MP3_NAMES[number] | 'artwork'; blob: Blob }[] = MP3_NAMES.map(name => ({ name, blob: files[name] }));
                const url = capture.metadata.trackArtworkSrc;
                if (typeof url === 'string' && /^https:\/\/[^/]*scdn\.co\//.test(url)) {
                  try {
                    const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: 'omit' });
                    const blob = await response.blob();
                    if (response.ok && blob.size <= 10 * 1024 ** 2 && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) blobs.push({ name: 'artwork', blob });
                  } catch { /* URL remains available when artwork cannot be fetched. */ }
                }
                const p: PreparedAudio = { id: capture.id, capture, metadata, encoding, files: [] };
                for (const { name, blob } of blobs) p.files.push({ name, bytes: blob.size, sha256: await sha256(blob), type: name === 'artwork' ? blob.type : 'audio/mpeg' });
                await request('work-begin', { ...args, manifest: p });
                const totalBytes = blobs.reduce((total, file) => total + file.blob.size, 0); let savedBytes = 0;
                for (const { name, blob } of blobs) for (let index = 0; index < Math.ceil(blob.size / CHUNK_BYTES); index++) {
                  if (stopped || lost || pausedRun || !queueEnabled) throw new Error('Separation paused.');
                  await request('work-append', { ...args, name, index, base64: await encodeBlobChunk(blob, index) });
                  savedBytes += Math.min(CHUNK_BYTES, blob.size - index * CHUNK_BYTES);
                  report({ phase: 'encoding', fraction: 1, message: `Saving stems · ${Math.round(savedBytes / totalBytes * 100)}%` });
                }
                finishing = true;
                report({ phase: 'encoding', fraction: 1, message: 'Verifying saved stems…' });
                await request('work-finish', args);
              },
            });
        } catch (error) {
          if (!stopped && !lost && !pausedRun && queueEnabled) {
            const message = error instanceof Error ? error.message : String(error);
            if (sharedQueue) await request('work-failure', { ...args, error: message.slice(0, 500) }).catch(() => {});
            onError(message, String(capture.metadata.trackId));
          }
        }
        finally {
          if (pausedRun || !queueEnabled) attempted.delete(capture.id);
          clearInterval(heartbeat); worker?.dispose(); if (separator === worker) separator = undefined;
          onProgress(String(capture.metadata.trackId), null);
          await request('work-release', args).catch(() => {});
        }
      }
    } catch (error) { if (!stopped) onError(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  }
  void tick();
  const timer = setInterval(() => { void readState(); void tick(); }, 1500);
  return () => { stopped = true; clearInterval(timer); separator?.dispose(); };
}

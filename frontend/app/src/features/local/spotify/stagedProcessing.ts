import { nextSeparationFraction } from '../rowProgress';
import { progressActivity } from './progressActivity';
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
  dependencies: { request?: typeof spotifyRequest; createSeparator?: () => Worker; process?: typeof processLocalTrack } = {},
  onStartup: (message: string) => void = () => {}) {
  const request = dependencies.request || spotifyRequest;
  const createSeparator = dependencies.createSeparator || (() => new LocalSeparator({ backend: queueBackend === 'wasm' ? 'wasm' : undefined }));
  const process = dependencies.process || processLocalTrack;
  let stopped = false, busy = false, separator: Worker | undefined, queueEnabled = true, pausedRun = false, sharedQueue = false, stateBusy = false;
  let overall: number | null = null, queueBackend: 'auto' | 'wasm' = 'auto';
  let recovered = false, separatorBackend = '';
  let idleAt = Date.now();
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
      if (!recovered) onStartup('Connecting to separation queue…');
      const capability = await request<{ stagedAudio?: boolean; extensionQueue?: boolean; workRecovery?: boolean; backgroundQueue?: boolean }>('hello');
      if (!capability.stagedAudio) return;
      if (capability.backgroundQueue && location.pathname !== '/separation-worker') { onStartup(''); return; }
      sharedQueue = !!capability.extensionQueue;
      if (stopped) return;
      if (capability.workRecovery && !recovered) { onStartup('Recovering interrupted separation…'); await request('work-recover'); }
      if (!recovered) { recovered = true; onStartup('Checking saved recordings…'); }
      if (stopped) return;
      await readState();
      if (!queueEnabled) return;
      const pending = await request<QueuedCapture[]>('work-pending');
      if (!pending.length && Date.now() - idleAt > 180000) { separator?.dispose(); separator = undefined; }
      onStartup('');
      for (const capture of pending) {
        if (stopped || !queueEnabled) break;
        if ((capture.processingError && (!capture.retryAt || capture.retryAt > Date.now())) || (!sharedQueue && attempted.has(capture.id))) continue;
        const token = await request<string | null>('work-claim', { id: capture.id });
        if (!token) continue;
        if (stopped || !queueEnabled) { await request('work-release', { id: capture.id, token }); break; }
        attempted.add(capture.id); overall = null; pausedRun = false;
        let lost = false, finishing = false, latest: SeparationProgress | null = null, touchedAt = Date.now(), renewing = false, pendingRenew = false, lastProgressAt = Date.now();
        const args = { id: capture.id, token };
        let worker: Worker | undefined;
        const renew = () => {
          if (stopped || lost || finishing) return;
          if (renewing) { pendingRenew = true; return; }
          renewing = true; touchedAt = Date.now();
          const visible = latest ? progressActivity(latest, lastProgressAt) : null;
          if (visible) onProgress(String(capture.metadata.trackId), visible);
          void request('work-touch', { ...args, ...(visible ? { progress: { fraction: overall ?? 0, message: visible.message } } : {}) }).catch(error => {
            if (finishing) return;
            lost = true; worker?.dispose(); if (!stopped) onError(String(error), String(capture.metadata.trackId));
          }).finally(() => { renewing = false; if (pendingRenew) { pendingRenew = false; renew(); } });
        };
        const report = (progress: SeparationProgress) => {
          const stageChanged = !latest || latest.phase !== progress.phase || latest.message.replace(/\d+(?:\.\d+)?%/g, '') !== progress.message.replace(/\d+(?:\.\d+)?%/g, '');
          if (!latest || latest.phase !== progress.phase || latest.message !== progress.message || latest.fraction !== progress.fraction) lastProgressAt = Date.now();
          latest = progress; overall = nextSeparationFraction(overall, progress);
          onProgress(String(capture.metadata.trackId), progress);
          if (stageChanged || Date.now() - touchedAt > 2000) renew();
        };
        const heartbeat = setInterval(renew, 10000);
        try {
          report({ phase: 'loading', fraction: 0, message: capture.attempts ? 'Restarting interrupted separation…' : 'Starting separation worker…' });
          if (!separator || separatorBackend !== queueBackend) { separator?.dispose(); separator = createSeparator(); separatorBackend = queueBackend; }
          worker = separator; idleAt = Date.now();
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
                report({ phase: 'encoding', fraction: 1, message: 'Preparing saved stems…' });
                const blobs: { name: typeof MP3_NAMES[number] | 'artwork'; blob: Blob }[] = MP3_NAMES.map(name => ({ name, blob: files[name] }));
                const url = capture.metadata.trackArtworkSrc;
                if (typeof url === 'string' && /^https:\/\/[^/]*scdn\.co\//.test(url)) {
                  try {
                    report({ phase: 'encoding', fraction: 1, message: 'Loading album artwork…' });
                    const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: 'omit' });
                    const blob = await response.blob();
                    if (response.ok && blob.size <= 10 * 1024 ** 2 && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) blobs.push({ name: 'artwork', blob });
                  } catch { /* URL remains available when artwork cannot be fetched. */ }
                }
                const p: PreparedAudio = { id: capture.id, capture, metadata, encoding, files: [] };
                for (const { name, blob } of blobs) {
                  report({ phase: 'encoding', fraction: 1, message: `Checking ${name === 'input' ? 'original' : name} file…` });
                  p.files.push({ name, bytes: blob.size, sha256: await sha256(blob), type: name === 'artwork' ? blob.type : 'audio/mpeg' });
                }
                await request('work-begin', { ...args, manifest: p });
                const totalBytes = blobs.reduce((total, file) => total + file.blob.size, 0); let savedBytes = 0;
                for (const { name, blob } of blobs) for (let index = 0; index < Math.ceil(blob.size / CHUNK_BYTES); index++) {
                  if (stopped || lost || pausedRun || !queueEnabled) throw new Error('Separation paused.');
                  await request('work-append', { ...args, name, index, base64: await encodeBlobChunk(blob, index) });
                  savedBytes += Math.min(CHUNK_BYTES, blob.size - index * CHUNK_BYTES);
                  report({ phase: 'encoding', fraction: 1, message: `Saving stems · ${Math.round(savedBytes / totalBytes * 100)}%` });
                }
                report({ phase: 'encoding', fraction: 1, message: 'Verifying saved stems…' });
                finishing = true;
                await request('work-finish', args);
              },
            });
        } catch (error) {
          if (!stopped && !lost && !pausedRun && queueEnabled) {
            const message = error instanceof Error ? error.message : String(error);
            if (sharedQueue) await request('work-failure', { ...args, error: message.slice(0, 500), recoverOnReload: error instanceof Error && error.name === 'TimeoutError', transient: !/invalid|unverified|truncated|incomplete recording|unsupported|signature|storage.*full|quota|not enough/i.test(message) }).catch(() => {});
            worker?.dispose(); separator = undefined;
            onError(message, String(capture.metadata.trackId));
          }
        }
        finally {
          finishing = true;
          if (pausedRun || !queueEnabled) attempted.delete(capture.id);
          clearInterval(heartbeat);
          if (stopped || lost || pausedRun || !queueEnabled) { worker?.dispose(); if (separator === worker) separator = undefined; }
          onProgress(String(capture.metadata.trackId), null);
          await request('work-release', args).catch(() => {});
        }
      }
    } catch (error) { if (!stopped) onError(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; if (!stopped) onStartup(''); }
  }
  void tick();
  const timer = setInterval(() => { void readState(); void tick(); }, 1500);
  return () => { stopped = true; clearInterval(timer); separator?.dispose(); };
}

import { commandTransport, readTransportDom } from './transport.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const CAPTURE_TIMING_VERSION = 1;

/** Capture transport is strict, unlike the best-effort Spotify mirror during DJ playback. */
export async function startPreciseCapture({ bridge, trackId, checkCancelled = () => {},
  transport = commandTransport, readTransport = readTransportDom, wait = delay }) {
  const check = () => {
    checkCancelled();
    if (readTransport().trackId !== trackId) throw new Error('Spotify changed songs while preparing capture. Retry this song.');
  };
  try {
    attempts: for (let restart = 0; restart <= 2; restart++) {
      check();
      await bridge.command('capture-abort');
      await transport({ action: 'pause' }); check();
      // Load/resume the audio graph before seeking and before any wanted audio plays.
      const prepared = await bridge.command('capture-prepare', { timeoutMs: 3000 }, 4000); check();
      let seekError = '';
      // Do not queue another Spotify seek if the actual media is already at zero.
      if (prepared.target.currentTime !== 0) {
        try { await transport({ action: 'seek', trackId, position: 0 }); }
        catch (reason) { seekError = reason?.message || String(reason); }
      }
      check();
      let settled = 0, corrected = false, lastMedia = null;
      // Allow buffering to finish without relaxing the verified-zero requirement.
      for (let attempt = 0; attempt < 200; attempt++) {
        check();
        const { media } = await bridge.command('listening-state');
        lastMedia = media;
        if (!corrected && attempt >= 10 && media?.source === prepared.target.source && media.paused &&
            !media.seeking && Number.isFinite(media.currentTime) && media.currentTime !== 0) {
          check();
          await bridge.command('capture-rewind', { expectedSource: prepared.target.source });
          corrected = true; settled = 0;
          await wait(50); continue;
        }
        if (media?.source === prepared.target.source && media.paused && !media.seeking &&
            media.readyState >= 3 && Number.isFinite(media.currentTime) && media.currentTime === 0 && media.playbackRate === 1) settled++;
        else settled = 0;
        if (settled >= 2) {
          const result = await bridge.command('capture-begin', { requireStart: true, expectedSource: prepared.target.source });
          check();
          if (!result.startVerified) throw new Error('Update and reload the ktv420 extension before capturing.');
          await transport({ action: 'play' }); check();
          // Spotify can apply a queued reset shortly after play. Observe startup
          // before handing capture to the normal song-boundary monitor.
          for (let sample = 0; sample <= 20; sample++) {
            check();
            const state = await bridge.command('capture-state');
            check();
            if (state.invalid) {
              if (state.invalidCode === 'startup-zero-seek' && restart < 2 &&
                  state.source === prepared.target.source) continue attempts;
              throw new Error(`Capture timing could not be verified: ${state.invalidReason || 'Audio was interrupted during startup.'} Nothing was saved.`);
            }
            if (state.ended) return result;
            if (sample < 20) await wait(50);
          }
          return result;
        }
        await wait(50);
      }
      const blockers = !lastMedia ? ['current audio unavailable'] : [
        lastMedia.source !== prepared.target.source && 'audio source changed',
        !lastMedia.paused && 'audio still playing', lastMedia.seeking && 'seek still pending',
        lastMedia.readyState < 3 && 'audio still buffering',
        lastMedia.currentTime !== 0 && `audio position ${Number(lastMedia.currentTime).toFixed(3)}s`,
        lastMedia.playbackRate !== 1 && 'audio speed is not 1×',
      ].filter(Boolean);
      throw new Error(`Spotify did not settle at the beginning: ${blockers.join(', ') || seekError || 'start did not stay stable'}. Nothing was saved.`);
    }
  } catch (error) {
    await bridge.command('capture-abort').catch(() => {});
    throw error;
  }
}

export function captureTiming(capture, duration) {
  // The initial duration is provisional for compressed streams. Only use the
  // final snapshot from the same source after a verified natural completion.
  if (capture.endVerified === true && Number.isFinite(capture.mediaDuration) && capture.mediaDuration > 0) {
    duration = capture.mediaDuration;
  }
  const frames = capture.byteLength / (capture.channelCount * 4);
  const seconds = frames / capture.sampleRate;
  const difference = seconds - duration;
  let reason = '';
  if (!capture.startVerified || !Number.isFinite(capture.startMediaTime) || capture.startMediaTime !== 0) {
    reason = 'The start of the song was not verified.';
  } else if (capture.invalid) {
    reason = capture.invalidReason || 'The audio changed or its timing was interrupted during recording.';
  } else if (![1, 2].includes(capture.channelCount) || !Number.isFinite(capture.sampleRate) || capture.sampleRate <= 0 ||
      !Number.isSafeInteger(frames) || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
    reason = 'The recorded audio or song duration is invalid.';
  } else if (frames !== Math.round(duration * capture.sampleRate) &&
      // This is a container/decoder discrepancy only after the page collector
      // verifies natural completion and an unbroken stream. No early stops.
      !(capture.endVerified === true &&
        Math.abs(Math.round(duration * capture.sampleRate) - frames) <= Math.ceil(capture.sampleRate * .05) &&
        Number.isSafeInteger(capture.rawCapturedFrames) && capture.rawCapturedFrames >= frames &&
        (difference > 0 || capture.rawCapturedFrames === frames))) {
    reason = `Recording is ${Math.abs(difference).toFixed(3)} seconds ${difference < 0 ? 'short' : 'long'}.`;
  }
  if (reason) throw new Error(`Capture timing could not be verified: ${reason} Nothing was saved.`);
  return { captureTimingVersion: CAPTURE_TIMING_VERSION, captureStartVerified: true, captureEndVerified: capture.endVerified === true,
    capturedFrames: frames, rawCapturedFrames: capture.rawCapturedFrames ?? frames, expectedDurationSeconds: duration, captureDurationErrorSeconds: difference };
}

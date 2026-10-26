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
    check();
    await bridge.command('capture-abort');
    await transport({ action: 'pause' }); check();
    // Load/resume the audio graph before seeking and before any wanted audio plays.
    const prepared = await bridge.command('capture-prepare', { timeoutMs: 3000 }, 4000); check();
    await transport({ action: 'seek', trackId, position: 0 }); check();
    let settled = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      check();
      const { media } = await bridge.command('listening-state');
      if (media?.source === prepared.target.source && media.paused && !media.seeking &&
          media.readyState >= 3 && Number.isFinite(media.currentTime) && media.currentTime === 0 && media.playbackRate === 1) settled++;
      else settled = 0;
      if (settled >= 2) {
        const result = await bridge.command('capture-begin', { requireStart: true, expectedSource: prepared.target.source });
        check();
        if (!result.startVerified) throw new Error('Update and reload the ktv420 extension before capturing.');
        await transport({ action: 'play' }); check();
        return result;
      }
      await wait(50);
    }
    throw new Error('Spotify did not settle at the beginning. Nothing was saved; retry this song.');
  } catch (error) {
    await bridge.command('capture-abort').catch(() => {});
    throw error;
  }
}

export function captureTiming(capture, duration) {
  const frames = capture.byteLength / (capture.channelCount * 4);
  const seconds = frames / capture.sampleRate;
  const difference = seconds - duration;
  if (capture.invalid || !capture.startVerified || !Number.isFinite(capture.startMediaTime) ||
      capture.startMediaTime !== 0 || !Number.isInteger(frames) ||
      !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds) || seconds <= 0 ||
      frames !== Math.round(duration * capture.sampleRate)) {
    throw new Error('Capture timing could not be verified. Nothing was saved; capture this song again from the beginning.');
  }
  return { captureTimingVersion: CAPTURE_TIMING_VERSION, captureStartVerified: true,
    capturedFrames: frames, rawCapturedFrames: capture.rawCapturedFrames ?? frames, expectedDurationSeconds: duration, captureDurationErrorSeconds: difference };
}

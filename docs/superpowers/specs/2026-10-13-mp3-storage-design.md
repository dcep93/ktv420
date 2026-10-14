# 320 kbps local MP3 storage

The user approved doubling the raw capture limit and replacing completed-song storage with 320 kbps MP3. Capture and Demucs input remain finite Float32 at the original rate; only the saved output is lossy. No library migration or separate legacy playback implementation is wanted. Existing Web Audio decoding can continue accepting WAV.

## Design

Raise the raw capture cap from 512 MiB to 1 GiB, with matching error text and boundary tests. After separation, encode the original and four stems locally in a dedicated Web Worker using pinned @audio/encode-mp3 2.0.1 (LAME WASM). Choose constant 320 kbps stereo and patch the final Info/LAME header so encoder delay and padding are explicit. All files must have identical decoded duration and sample alignment. For source rates not supported by MPEG-1, resample all five to 44.1 kHz consistently; preserve original capture metadata. Encoding must not block the player UI.

Use a common gain across all five signals when headroom is needed, never independently normalize stems. Preserve this gain as trusted validated playback metadata and undo it after decoding. Do not silently clip finite out-of-range Float32 input.

The extension accepts a bounded atomic five-MP3 commit through protocol v2. Check exact file names, rate, channel count, CBR headers, complete MP3 frames, Info/LAME frame count and delay/padding against expected audio length, bounded metadata and gain. Preserve the raw original if encoding, validation, cancellation, or storage fails. Remove temporary originals and any prior stems only inside the successful transaction; set ready and exact compressed byte count in that transaction. Remove the old WAV output commit path rather than maintain two writers. Playback continues using the existing generic decoder.

No UI redesign or automatic conversion/deletion of existing ready songs. No GCP, upload, new permission or local server dependency. The hosted worker includes its encoder; bundled WASM data URLs require a narrowly scoped CSP connect-src data allowance. Update notices. Release extension 0.5.0 in the existing ktv420/extension folder after publishing the matching website. Old bridges must clearly request an extension update.

## Alternatives considered

MediaRecorder cannot guarantee 320 kbps MP3. A plain MP3 encoder without gapless metadata risks timing shifts. Full ffmpeg WASM adds a substantially larger runtime. A small LAME WASM encoder with a verified gapless header fits the existing worker architecture.

## Verification

Test exact capture bounds without allocating GiB buffers; genuine encoded MP3 frame headers at 44.1/48 kHz; round-trip decoded duration and alignment using a browser; overrange common gain; cancellation and commit rollback; malformed/truncated/wrong-rate/wrong-length MP3 rejection; byte accounting and raw cleanup. Run all tests, lint and production builds. Inspect actual MP3 output with ffprobe if present. Check worker/CSP behavior and resulting files in a local browser, then verify deployment and refresh installed package in place. Do not claim real Spotify end-to-end playback unless exercised.

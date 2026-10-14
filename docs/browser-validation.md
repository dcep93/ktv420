# Browser validation — 2026-10-12

Host: Apple M5 MacBook Air, 16 GB RAM. Browser: Chromium in the Codex in-app browser. These measurements are **not** a Chrome extension installation test or a multi-device benchmark.

## Numerical verification

The pinned, full-Float32 split HTDemucs export is compared with original PyTorch Demucs 4.0.1. The browser uses whole-recording mono mean/unbiased-standard-deviation conditioning, deterministic zero random shifts, 7.8-second chunks and 25% overlap. It does not claim identical output to the former CLI's randomized default augmentation.

For a deterministic one-second stereo tone fixture, every one of the 352,800 output samples was compared to original PyTorch: maximum absolute difference **2.384185791015625e-7**, RMS difference **2.041014724658436e-8**. All four stems retained exactly 44,100 frames and were finite. Native compact ONNX plus the same FFT adapter independently matched PyTorch within 1.16e-5 maximum error. The WASM fallback also passed the same 352,800-sample comparison: maximum absolute difference 0.0001341403, RMS difference 0.0000066124. These are synthetic numerical checks, not an assessment of separation quality on a music collection.

## Timing

A 30-second synthetic stereo recording (1,323,000 frames/channel, six model chunks), same computer and browser, cached model, fresh worker/session:

| Backend | Wall time | Notes |
| --- | ---: | --- |
| WebGPU with WASM operator fallback | 7.55 s | Includes session initialization and output checks |
| Single-thread WASM compatibility | 47.91 s | Includes session initialization and output checks |

GPU was **6.35× faster than this single-thread browser CPU fallback**. This is not a comparison with native CPU Demucs, multithreaded WASM, or Docker. First download adds network-dependent time. Longer-track memory behavior and other devices require further validation.

## Integration

Automated tests cover Float32 preservation, native WAV originals, mono channels, invalid audio/derived spectral overflow, resampling, chunk edges, optional model-cache failure, atomic library commits, capture ownership/order/retry, and cancellation before inference/during commit. Build and lint pass.

Browser library checks: local Float32 WAV imports at native rate; starting separation keeps original playback running; cancelling retains input and does not reset playback position. Exported vocals were inspected with ffprobe: PCM Float32 little-endian, stereo, 44,100 Hz, exactly 30.000000 seconds. Library contents survived a full page reload and all five saved WAVs reopened. Packaged extension and Spotify account capture are separate checks and must not be inferred from localhost success.

## Spotify workflow restoration — 2026-10-13

The user requested the original Spotify capture flow and in-Spotify overlay, with no required file-import or manual separation step. `spotify-preview.html` is a development-only embedded fixture using the same capture staging/commit functions, parent/overlay protocol and actual local model worker. Two synthetic stereo captures were committed through begin/chunk/finish, automatically separated, and displayed as ready in playlist order in the embedded player. This fixture does **not** validate Spotify's real audio hooks or Chrome's installed-extension embedding behavior.

Queue tests cover arrivals during processing, interrupted-track recovery, exclusion of file imports/completed/failed tracks, continuing after failure and pause behavior. The overlay retains its document when hidden. The packaged HTML is web-accessible only to Spotify; its parent message bridge checks origin and source. Chrome documents that embedded extension pages retain their extension storage partition: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies .

## Installed-extension confirmation — 2026-10-13

The user confirmed that real Spotify capture → local separation → stem playback works in the installed Chrome extension. This satisfies the agreed cloud-retirement gate. The confirmation is a user-run functional check, separate from the synthetic numerical and timing measurements above; it does not establish performance or compatibility on other devices.

The dedicated legacy cloud audio service and bucket were subsequently deleted, with new soft deletion disabled before removing storage. The post-deletion inventory showed neither resource. The repository's obsolete audio-cloud credential was removed and its one-time maintenance workflow disabled. The shared project's unrelated resources and the static installation website were preserved. No archive was created.

## Hosted player split — local candidate, 2026-10-13

The browser fixture now embeds the broker at localhost:5174 and the player at 127.0.0.1:5174, exercising a real cross-origin message boundary. Two one-second synthetic captures passed through the existing capture staging API, were automatically separated with the actual model, and returned as ready tracks through the storage broker. Stem playback advanced and the visualizer selector worked. Both tracks remained ready after a full page reload. Pause survived a reload and Resume restored automatic processing. This is a development browser test, not an installed-extension or production-hosting test.

The candidate ZIP contains capture code, the storage broker and background worker; React, visualizers and ONNX runtime files are absent. The hosted build contains the player and runtime. Builds leave the currently installed extension/build intact. Production framing/CSP and the new installed-extension path require verification after publication is authorized. No push or deployment was performed for this candidate.

RPC tests cover wrong peers/origins/versions, operation and size bounds, malformed or partial stems, exact Float32 values, existing database access, lock contention/disposal, shared pause state and multiline errors. Deployment tests verify retention and integrity of old hashed worker files and versioned runtimes so open sessions can continue to load their matching code.

Final candidate checks: 45 tests passed; ESLint, TypeScript and both production builds passed. Reloaded client request IDs are unique across documents to reject delayed replies. Extension candidate totals 113,784 uncompressed bytes. The installed extension remains version 0.3.3 until the hosted player is published and the candidate is explicitly installed.

## Hosted release — 2026-10-13

Published commit `75c1f3a` through successful GitHub Actions run 38501228397. Live player HTML, JavaScript, CSS, versioned WASM MIME type and extension ZIP checksum were verified. The production top-level player rendered its Spotify instructions in Chromium. Installed files at `ktv420/extension` were updated to 0.4.0 and matched the published broker/manifest byte-for-byte. Chrome still needs an extension Reload and Spotify refresh; real production embedded capture/playback is not yet confirmed.

## Compact Multisport theme — 2026-10-13

The homepage now has a pink title, one-line tagline, three installation steps and keyboard-operable collapsed help. Browser checks confirmed the canonical title color (`rgb(255, 123, 195)`) and native Comic Sans / locally bundled Comic Relief font stack. The font bytes match newapp's reference; Vite emits a hashed TTF retained by the player asset manifest. Shared theme assets are also packaged for the static guide.

The cross-origin synthetic fixture retained both saved tracks, displayed concise stem names, played saved stems with advancing position, switched visualizers and opened the settings/device menu. The picker uses one-line labels with accessible descriptions/tooltips. Amber sliders, brown selects, keyboard focus and the compact close/k/settings header were checked visually. These are presentation/integration checks with synthetic audio, not a new real-Spotify capture confirmation.

All 45 tests, ESLint and both builds passed. Independent spec and code reviews passed. All 28 installed extension files remained byte-for-byte identical; no extension release or reinstall is needed for this theme. A landing stylesheet URL change avoids reuse of the old cached CSS during the transition, and new HTML/theme responses revalidate thereafter.

## 320 kbps MP3 storage (2026-10-13)

Completed tracks now use five MPEG-1 Layer III 320 kbps stereo MP3 files, with a finalized Info/LAME header. The earlier WAV export measurements above describe the previous storage format. No existing ready tracks are migrated.

Automated checks use the real pinned LAME WASM encoder at 32, 44.1 and 48 kHz and resample a 22.05 kHz fixture. They verify common headroom gain, exact gapless sample counts, rate/bitrate/channel headers, frame and byte totals, header/audio checksums, truncation and damaged header/payload rejection. Library tests verify exact compressed-byte accounting, raw/source cleanup, rollback after audio writes, and cancellation before encoding, during encoding, and at the commit boundary. The exact 1 GiB raw capture limit is tested by staging metadata without allocating a GiB of samples.

`npm test` passes 56 tests; `npm run lint` is clean; hosted and extension production builds pass. The encoder exists only in the hosted MP3 worker; the extension contains the small validation parser. Packaging produces a 0.5.0 candidate without changing the installed build unless explicitly run with `--install`.

Independent Chrome worker/broker/IndexedDB checks also passed for 44.1 kHz, 48 kHz and 96 kHz input (converted to 44.1 kHz). All five decoded files have the expected exact frame count. Shared gain restoration preserves amplitude ratios 1, 0.5, 0.25, 0.125 and 0.0625. A truncated file is rejected while raw input remains; successful commits remove the raw input and account exact MP3 bytes. Cancellation returns AbortError, the browser event loop continues ticking during encoding, and no JavaScript errors were observed. Direct encoder tests also cover 1-frame, 127-frame and 3-second-plus-137-frame clips at 44.1/48 kHz and preserve impulse positions at samples 1000 and 2000. These synthetic checks do not claim a new Spotify capture end-to-end run.

The built production worker also passed in Chrome under the exact Firebase Content Security Policy. A 30-second-plus-137-frame fixture at 44.1 kHz produced five MP3 files totaling 6,013,380 bytes, compared with 52,925,480 bytes of Float32 audio. All five decode to exactly 1,323,137 frames. Encoding took about 900 ms while the UI event loop ticked 179 times; there were no CSP violations or JavaScript errors. The production validation result is saved at `/Users/danielcepeda/repos/_codex_output/ktv420/mp3-production-worker.json`.

The actual player opened through the Spotify preview with all five MP3 visualizers loaded and no JavaScript errors; screenshot: `/Users/danielcepeda/repos/_codex_output/ktv420/mp3-player-preview.png`.

Final MP3 player check: opened the actual nested broker/player through the development Spotify fixture, loaded all five ready MP3 tracks, verified compact stem labels, started/paused playback (position advanced to 0.3 seconds), and exported `input.mp3` through the UI. ffprobe confirmed MP3 stereo, 44,100 Hz, 320,000 bit/s. No browser JavaScript errors. This uses synthetic audio, not a live Spotify capture. Independent spec and quality reviews approved; the quality review additionally exercised 36 rate/length boundary cases.

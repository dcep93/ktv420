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

## JSON performances (6.2.0)

The local `dom-playback-preview.html` fixture's **Run record/replay tests** exercises the real hosted React player, guarded broker, local audio storage, detached audio capture and Spotify DOM adapter with synthetic audio. Verified recording context, all three samples of a fader gesture, remote pause/resume and seek, recording across two songs, JSON reimport through the broker, pausing a complete replay, completion, silent Spotify monitoring and final companion pause. The fixture suppresses its JSON download and inspects the locally saved performance instead. It is excluded from the production build.

Node tests cover bounded v2 JSON validation, independent performance timing, persistence across database reopen, external-message origin/frame restrictions, persist-before-navigation handoff, per-tab isolation, broker replay handshakes/reload, and capture scoped to required songs with initial zero monitoring gain. Old v1 files are rejected rather than guessing lost timing. Reloading an unfinished recorder offers a partial autosave. Unexpected remote song changes or large seeks stop replay explicitly. Recording into an unprepared next song stops and saves the current performance.

This is browser-fixture evidence, not proof of the complete real-Spotify or Chrome Web Store installation flow. Automated file-chooser upload is unavailable in this Chrome automation setup; installation, importing a real recording and playback against the user's Spotify account still need the final user check. Independently captured/separated stems are not promised to be bit-identical across computers, and replay automation uses browser scheduling rather than sample-accurate offline rendering.

## Independent tempo and pitch (6.3.0)

Approved scope is tempo and pitch only, with a performance gate; no scene system was added. The hosted player uses pinned Signalsmith Stretch 1.3.2 (MIT), one multichannel AudioWorklet/WASM processor and a shared song clock. Neutral 1× / zero pitch uses native buffer sources; altered playback uses the processor. Paused/disposed processing is disconnected. Tempo ranges 0.5–1.5×; pitch ranges −12–+12 semitones independently. These are reversible playback transformations, not edits to stored MP3s.

On the same Apple M5 MacBook Air, Chrome's actual DJ fixture retained **60 FPS** at 1×/0, 1.5×/+12 and 0.5×/−12 with five stereo tracks and the existing visualizers. 95th-percentile frame intervals were 17.5–17.7 ms, maximum 19.3 ms; displayed-position vs local Spotify media drift was 0.043–0.079 seconds. These are local synthetic measurements, not guarantees for every computer or visualizer.

The built, minified engine was separately served under the exact Firebase player CSP. Six ten-channel output cases passed frequency, duration and non-silence checks: neutral, 1.5×, 0.5×, +12, −12, and 1.5×/+7. Altered playback rendered at 0.161–0.181 seconds per second of output (roughly 5.5–6.2× real time); earlier development runs were 4–5×. This is offline wall time, not an OS CPU percentage. Neutral rendered at 0.018 seconds per second using the native bypass. Setup for these eight-second buffers took 19–33 ms. The processor retains an additional decoded buffer copy while the player is loaded; storage size is unchanged. Frequency estimates use two-second zero-crossing windows, so are quantized to 0.5 Hz. Processed stereo samples are not bit-identical even for duplicated mono; maximum channel difference in these fixtures was 0.00058 at 0.1 input amplitude. No claim of lossless or artifact-free time stretching is made.

The real recorder/replay fixture passed eleven assertions including tempo/pitch snapshots, two-song replay, fades, pause/resume, seeks, silent Spotify and final pause. Routing/capture passed eighteen assertions including restored 1× on heartbeat loss, normal-speed next-song capture, original PCM amplitude/duration despite muted monitoring, rejected partial capture and an explicit pause when Spotify resets the requested tempo. Tempo commands are bounded, track-scoped and coalesced during slider drags. V3 files retain both settings; V2 loads with neutral defaults. The install page detects an older extension before sending a V3 recording.

82 automated tests, lint and builds are part of the release checks. Development fixtures are excluded from deployment. Actual Spotify accepting playbackRate and remote-device behavior still require installed-extension validation; a rejected/reset rate pauses playback explicitly. The new extension is required for tempo synchronization; no permissions were added. Website and extension versions must be updated together.


### Escape closes and pauses (6.3.1)

Escape and Close stop local playback, cancel pending replay actions, pause Spotify through the existing DOM transport, and hide the overlay. Escape also works when focus remains on Spotify or the bridge loading/error screen; it is ignored by the content script while the overlay is closed. Separation is left running. An active performance recording is saved when closing.

Validated with the synthetic DOM/browser fixture: all 13 record/replay assertions passed, including closing during playback and during replay preparation, with a two-second check for unwanted restart. Unit coverage checks the parent Escape handler, Close parity, trusted bridge forwarding, and ignoring Escape outside the overlay. This does not replace a real Spotify check after reloading the extension.

## Replay MP3 export — 2026-10-14

The hosted player renders saved/imported performances with the shared mixer gain curve, effects routing and Signalsmith tempo/pitch engine, then encodes one continuous 320 kbps stereo MP3 at 44.1 kHz. Song transitions use fresh graphs, matching replay; pauses retain any existing effect tail. Output ends at the recorded Stop timestamp. Automation is applied at 128-sample render boundaries (under 3 ms), rather than claiming sample-exact reproduction of real-time browser scheduling. Monitor volume is excluded. Overrange output receives one uniform attenuation before encoding. MP3 is lossy and this export adds another encoding generation.

The minified `export-preview.html` fixture, served under the exact Firebase player CSP, passed 32 assertions: timeline and stereo preservation, pause/resume, every one of the 17 effects compared against an independently constructed reference graph, independent tempo/pitch and mid-song changes, forward/backward seeks, logarithmic fader smoothing, two-song gapless MP3 duration, cancellation while rendering and encoding, scratch cleanup, and a successful export after cancellation. Static effect waveforms matched their reference before MP3 encoding; this is synthetic evidence, not a claim that all recorded performances or independently separated stems are bit-identical.

A five-minute synthetic performance with five stereo inputs, repeated seeks, tempo/pitch changes, reverb, delay and fader automation produced 12,002,742 bytes and decoded to exactly 300 seconds. Every tested one-second interval remained audible. Development took 22.75 seconds (13.18× real time); the minified production-policy run took 93.29 seconds (3.22×). These are individual measurements on the Apple M5 MacBook Air, not guarantees. The fixture reuses eight-second source buffers, so it exercises five minutes of DSP, temporary PCM writing and MP3 encoding, but not decoding five minutes of unique source audio. Use approximately 1–2 minutes per five-minute mix as an initial estimate, pending real-music measurements.

The real React saved-recording card exported an MP3 through its new button and showed progress/Cancel while disabling conflicting operations. Temporary PCM is written to OPFS and removed after success/cancellation; a stale file is removed under an exclusive lock before the next export. Preflight checks cover song availability/duration, available disk quota and a 1.5 GiB estimated per-section buffer ceiling. The broker processing lock excludes separation/deletion. Export requires no capture, Spotify transport commands, model inference, network audio or new extension permissions.

Automated release checks: 87 tests, ESLint and hosted/extension production builds passed. The existing DOM record/replay fixture also passed all 13 assertions after the shared audio refactor, including tempo/pitch, remote controls, two-song replay and Escape during preparation. The export fixture is development-only and excluded from deployment. The installed extension remains 6.3.1; the feature is delivered by the hosted player.

## Visualizer additions and rendering polish — 2026-10-14

Added Stem Weather, Spectrogram and Stereo Bloom while retaining all 24 previous choices. Weather combines post-effect stem signals into one canvas and keeps the existing mixer controls below it; mute/solo excludes contributions and original playback receives a separate ambient glow. Spectrogram uses bounded 480×128 history with logarithmic frequency mapping, freezes on pause, and clears on seeks or return from a hidden view. Bloom reads separate stereo channels through silent side taps; those branches do not add to the audible output.

Shared rendering uses CSS-pixel coordinates with backing resolution capped at 2× and approximately 1.5 million pixels per canvas. Canvas backgrounds/fonts inherit the app theme and repeated per-panel timestamps were removed. Analyser arrays are reused. Intersection/document visibility gate painting; paused canvases settle for 1.5 seconds, then stop redundant painting. Existing artwork retains its palettes.

The actual React player / Spotify DOM fixture passed 26 assertions, including independent stereo levels, unchanged output samples with stereo taps attached, canvas counts and resolution bounds, proof that visible canvases actually paint, preserved spectrogram frequencies after pause, frozen history, seek reset, hidden/paused painting suppression, muted Weather, and recording/replaying all three new visualizer selections. The new fixture report sits below the player so growing test output cannot move the tested canvases offscreen. Earlier background measurements were 30 FPS; the final foreground run was 60 FPS in every mode.

With five synthetic stems loaded and visible panels rendering at 1.5× tempo / +12 semitones on the Apple M5 MacBook Air:

| Mode | FPS | 95th percentile frame | Maximum frame |
| --- | --- | --- | --- |
| Time Ribbon baseline | 60 | 17.4 ms | 18.4 ms |
| Stem Weather | 60 | 17.2 ms | 17.8 ms |
| Spectrogram | 60 | 17.3 ms | 17.8 ms |
| Stereo Bloom | 60 | 17.1 ms | 17.9 ms |

These are short, synthetic, local-browser measurements with the viewport's visible panels; they do not guarantee performance on every device or fullscreen size. The separate minified synthetic visual preview rendered all three modes under the exact Firebase player CSP with no console errors, and was visually inspected for theme, stereo shape and frequency history. Both preview fixtures are excluded from deployment.

91 automated tests (10 Node / 81 TypeScript), lint, TypeScript, and hosted/extension production builds passed. Extension APIs, permissions and installed files remain unchanged. Existing recordings continue using their original visualizer IDs; new IDs use the existing recording format.

## Best-effort Spotify synchronization (6.3.17)

The hosted player now performs play, pause, seek and tempo changes locally.
Ready-song selection and local next/previous navigation do not wait for Spotify.
Replay waits for local stems, never for Spotify acknowledgments. Reliable remote
play/pause/seek edges are still observed; stale state, disconnection, ordinary
timeline drift and reflected commands do not continuously steer the local clock.
Spotify remains at 1× with no periodic seeks. Native song changes still select a
prepared song outside replay; replay retains its recorded sequence.

The extension marks best-effort commands and their settling observations, keeps
Spotify monitoring silent during custom playback, and logs sync failures without
turning them into capture/player errors. Explicit capture retains its stricter
validation. Volume responds locally before Spotify's DOM update.

Validation: a regression test reproduces the exact rejected-native-seek message,
checks that best-effort failure preserves volume and does not start capture, and
checks that strict seek failure is still reported. Observer tests cover drift,
remote edges, stale/error/disconnected observations, reflected commands and
protocol validation. A temporary browser fixture exercised the actual Player:
local play/seek/pause under rejected sync, 1.5× tempo under stale state, continued
playback after disconnection, and fresh remote play/pause. The actual useReplay
hook completed a track/play/seek/pause/play/stop performance while Spotify
continually reported a seek error and never acknowledged commands. This uses
synthetic audio and state, not a claim of a completed real-Spotify device test.

## Combined Highway (2026-10-26)

Highway now uses the combined-scene canvas and the stable `highway` recording
identifier. A shared projected road replaces the former per-stem renderer.
Synthetic browser inspection confirmed vocal mute removes the sun/waveform and
other mute removes mountains/cacti; pause and seek retain coherent perspective.
The 1050 × 340 preview measured 0.39 ms mean / 0.90 ms p95 for 120 frames of CPU
drawing commands plus analysis (not total GPU/compositor cost). Automated checks
cover monotonic perspective, finite bounded rendering at three sizes, solo/mute,
large/backward seeks, balanced canvas state, and replay registration.

## Time Ribbon stability (2026-10-26)

The ribbon uses fixed song-time envelope vertices and gradual spectral-centroid
color transitions. The development-only `ribbon-preview.html` drives the actual
renderer with narrow waveform peaks and two frequency bins whose loudest winner
alternates every frame. Wide and compact browser views were inspected while
playing, paused, seeking fifteen seconds ahead and resuming. No audio output is
used by this synthetic fixture. Three regression tests cover stable translation,
bounded hue transitions, silence, seeks, finite coordinates and balanced canvas
state. All 141 tests, lint and both production builds passed.

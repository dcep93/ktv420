# Extension 7.6.1 release verification

2026-10-31. This release keeps the 7.6 shared-library architecture. It does not move orchestration between the extension and website or change permissions.

## Fix

A real Chromium AudioWorklet capture intermittently reported a missing first quantum before collecting any samples (expected frame 256, received frame 384). Two failures occurred during initial browser verification. The collector now identifies an empty startup gap during the first second. The existing startup loop discards that entire attempt, pauses and verifies the same song at zero, and re-arms capture. At most two startup retries are allowed. A source change, a later gap, or any gap after samples have been collected remains an error. No missing samples are padded or accepted.

## Verification

- 404 automated tests passed (97 JavaScript, 307 TypeScript), plus lint and production builds.
- Twelve fresh Chromium capture runs after the fix passed. One exercised the retry naturally. All WAV fixtures matched the decoded reference sample-for-sample: 150,576 stereo frames at 48 kHz, with the first signal at frame 1,024 and the last at frame 150,575.
- A separate browser test deliberately dropped the first block. The attempt was discarded, playback restarted once, and the replacement recording matched the entire reference with zero maximum sample error.
- The existing precision browser scenarios also passed: pause/resume, 200 ms main-thread contention, delayed end event, repeated zero seek, ignored UI seek, delayed startup seek, failed pause acknowledgment and stale Play control. The MP3 fixture passed timing validation; compressed media-element decoding is not claimed to be sample-identical to offline decoding.
- The real Demucs CPU worker processed a short synthetic recording with every visible tab closed. The website subsequently saw one Ready track and all five MP3 files. No prepared output copy remained in extension storage.
- Killing the offscreen document during inference and opening the website acquired a new worker claim in approximately 1.15 seconds. Separation completed and the shared library contained the finished audio.
- The actual Spotify-origin → extension-origin → website-origin frame hierarchy read the same saved track as a top-level website page. Settings deletion removed that same shared record. An initial automation click did not expose Settings before its timeout; an isolated repeat passed. No cause was established for that click failure.
- The standalone player opened paused; track Close returned to the playlist, playlist Close returned to the catalog, and playback advanced in a background tab without a player error.

Browser checks used isolated Chrome for Testing profiles. Production Spotify capture was already running in the user's Chrome and was not stopped, refreshed, or modified. These checks are not a fresh end-to-end real-Spotify run of 7.6.1, a full-song GPU load test, or a 3 GB import test. Historical notes in standalone-library-verification.md apply to their stated versions; the current shared-library verification supersedes the earlier partitioning conclusion for this architecture.

## Package and activation

`dist/ktv420-extension.zip` is the Chrome Web Store upload package, generated from `extension/manifest.json`, packaged extension sources/assets, and the compiled background service worker. The only API permission remains `offscreen`; host permissions remain Spotify and ktv420.web.app. No storage or unlimitedStorage permission was added.

The developer dashboard blocked browser scripting, so this task did not upload or submit a Store release. Unpacked installations require an extension reload followed by a Spotify refresh after the current capture has finished. Reloading during capture cancels that recording.

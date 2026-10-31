# Standalone library verification — 2026-10-29

These are historical results for the versions named below. See [7.6.1 release verification](release-7.6.1.md) for the current shared-library architecture and release checks.

## Implemented

The website now owns canonical originals/stems, metadata and collections in a fresh `ktv420-web-library-v1` IndexedDB database. Import, catalog, playlist playback, the existing effects/visualizers and replay use website storage directly. The optional 7.0.0 extension exposes Spotify discovery and one-song precise capture, with a separate durable temporary queue. Version 7.1 restores the hosted iframe overlay over Spotify, with a packaged frame for shared website storage and a narrow Spotify relay. No general storage/API broker remains.

Capture delivery is chunked, sequential and resumable. The website acknowledges only after the input, metadata, collection and delivery receipt commit. An acknowledgment retry cannot duplicate or resurrect deleted audio. Original PCM survives a failed MP3 commit; all five MP3s must pass structural, duration and checksum validation before replacing it. Version-2 playlist packages preserve original and stems, shared gain, timing, artwork, metadata and repeated collection positions.

Old extension storage is untouched. No migration or version-1 package/extension protocol support is provided.

## Automated checks

The full test suite, lint, TypeScript build and separate website/extension production builds pass. Tests use fake IndexedDB for transaction rollback, delivery interruptions, idempotency, lost acknowledgments, quota/lock rejection and processing recovery. Production ZIP/folder code round-trips two songs with real LAME MP3s and verifies identical audio bytes, timing/gain, metadata and order. Existing precise capture, sample clock, end-boundary, effect and visualization tests remain. Removed tests exercised deleted overlay/broker protocols.

The generated extension background is approximately 7 KB uncompressed and imports no React, model, inference or website library code. The package contains only the capture integration and its local assets.

## Real browser checks (Codex Chromium, localhost)

- Without a Spotify extension: a two-song synthetic ZIP imported through the production importer into real IndexedDB; exported assets matched their hashes; the extracted folder was accepted without duplicating prepared tracks.
- Catalog showed both songs captured and ready. Track links opened the existing mixer paused.
- Playback started on click and advanced from Synthetic One to Synthetic Two. Reload remained paused and retained the adjusted 0.99× tempo.
- Existing mixer controls, visualizers, effects, recording and pitch/tempo UI render directly in the website. This is not a listening-quality review of every effect.

### Actual WebGPU run

The unchanged pinned Demucs worker ran a one-second stereo synthetic fixture twice in the standalone browser:

| Measurement | Result |
| --- | --- |
| First run | 8.6722 s |
| Warm run | 1.0368 s |
| Backend | WebGPU (WASM operator fallback) |
| Output | Four finite stems, 44,100 frames each |
| Numerical parity maximum error | 2.3842e-7 |
| Numerical parity RMS error | 2.0410e-8 |
| Model SHA-256 | e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077 |

These are model startup/warm measurements for a small fixture, not full-song throughput or a previous-version speed comparison. No before/after full-song benchmark was collected. Model/worker implementation is unchanged.

## Remaining live acceptance checks

On 2026-10-30, the reloaded 7.0.0 extension captured all five songs in the real **short kings** Spotify playlist. The website automatically scheduled each song, received all five originals, separated them and showed all five as Ready. Capture and website error logs were empty during the run. The catalog reported **5 of 5 captured · 5 ready**, with artwork and titles present.

A website refresh during processing retained the captures and resumed separation. Common Enemy opened paused at 00:00 / 00:16; clicking Play advanced its playback clock, then automatically advanced to The Kill. Playback was paused after verification. After closing Spotify, the catalog's direct website link still opened all five prepared tracks.

The live run also exposed a launch bug after Spotify SPA navigation: Chrome's message sender URL could still describe the original home page. Version 7.0.1 reads the current tab URL instead, validates the Spotify origin, and has a regression test for playlist/album navigation and leaving Spotify. This patch requires one more extension reload; its regression test is automated, while the actual capture run used 7.0.0 after refreshing at the playlist URL. The complete suite now has 298 passing tests, with lint and both production builds passing.

Closing every website tab during an active recording and reconnecting its queued delivery has not yet been exercised live. Durable queue/commit acknowledgment behavior is covered by the transaction tests. This run verified playback progression, not a subjective listening-quality or sample-by-sample comparison against a known Spotify reference signal.

A roughly 3 GB playlist was not imported in this run. The existing streaming ZIP writer, per-song importer and bounded delivery remain; round-trip verification used a small real-audio fixture. Sustained full-song GPU inference while listening, other operating systems and Chrome Web Store review remain separate acceptance checks.

## Overlay restoration (7.1.0)

The compact capture popup and separate-tab `spotifyTab` launch were removed. The existing hosted playlist/mixer is again embedded over Spotify. Commands use the enclosing extension frame’s trusted sender tab, and external website callers cannot select a Spotify tab. New tests cover cross-origin/source rejection, startup readiness before postMessage, URL navigation, close/reopen, Escape, title/favicon restoration and automatic sender binding. The website library and durable delivery queue are preserved. After reloading 7.1.0, native Chrome testing verified the full overlay, discovery of all 11 Mud album tracks, one-based track URLs, paused track entry, playback, and Escape/close returning to Spotify with playback paused. Browser instrumentation repeatedly left an empty `srcdoc` frame; native-only testing in a fresh tab rendered the overlay correctly.

Auto-open exposed a startup discovery race: an incomplete initial Spotify render was treated as a terminal failure. Commit `8e324f4` adds bounded sequential retries and cancellation before persisting a complete collection. The deployed fix passed 305 tests, lint and both builds. Native navigation to the Spotify URL with `?ktv420` then loaded the complete playlist without the previous error.

**Shared-library acceptance failed.** The first live capture saved Common Enemy in the overlay. Opening the standalone catalog during delivery received The Kill into a different library, and the overlay reported `Capture delivery transaction failed.` The standalone player showed Common Enemy as not captured and The Kill ready; the overlay showed the inverse. Host permissions alone did not provide shared storage/locks in this nested-frame arrangement. No storage-access permission prompt has been added; the user rejected that approach.

At the user's request, a normal recapture was run through the overlay's central k button after closing the temporary standalone test player. It skipped the already-ready Common Enemy, captured the remaining four songs, advanced normally, and separated all five songs to Ready. No delivery failure appeared during this run. A subsequent standalone catalog check still showed only 1 of 5 captured / 1 ready. Recapture therefore verifies the overlay capture path but does not resolve library sharing. The overlay was closed to pause Spotify, then reopened and left displaying all five Ready songs with playback paused. No existing audio was deleted.


## Capture-only overlay (7.2.0)

The Spotify overlay now renders a dedicated capture page and never mounts the mixer. Song clicks, the all-captured logo action and indexed links open top-level ktv420. The website is the sole delivery receiver and audio owner; the extension rejects overlay chunk reads and acknowledgments. Capture scheduling waits for the durable queue commit, not for website delivery/separation. Website status is cached as metadata only for overlay labels and skip decisions. No extra permissions or storage-access prompt are introduced. Existing isolated overlay recordings remain untouched and can be recaptured.

The Spotify launcher and app logo use the same opaque pink 2 px border. Redundant fullscreen permissions/attributes were removed from both capture frames.

Automated validation covers source-bound player URLs, refusal of audio delivery to the overlay, summary validation, queued-to-committed-to-ready status, deletion propagation, plus the existing capture and import tests. Lint and production builds pass. Live 7.2.0 capture-to-website verification requires reloading the installed extension; the preceding live test results apply to 7.1.0.

## Spotify volume synchronization (7.2.1)

The capture overlay no longer displays an invented 100% before Spotify status arrives or retains a permanent local slider override. Spotify’s DOM slider is authoritative, including zero and changes made between overlay openings. Overlay input updates immediately, coalesces DOM/monitor writes over 32 ms, and ignores stale status responses while a newer input is pending. A brief 200 ms settling window allows Spotify’s controlled input to update. Capture monitoring follows subsequent Spotify volume changes; captured PCM remains upstream of monitor gain. Missing initial volume leaves the slider unavailable rather than guessing full volume.

Six regression tests cover inherited/unknown volume, external changes, burst coalescing, settling, idle monitoring, and teardown. Live Spotify verification requires reloading extension 7.2.1.

## Extension staging and automatic imports (7.3.0)

The approved replacement for the offscreen/shared-storage proposal is implemented. The hosted Spotify overlay processes verified raw recordings through the existing Demucs/MP3 workers, reading and writing bounded chunks through a narrow relay into extension-origin staging. It does not save audio in its partitioned website database. It can separate one song while subsequent captures complete. Closing/pausing the overlay cancels the worker and releases its claim; inputs survive. Track view remains website-only, and the 7.2.1 inherited-volume fix is retained.

An open standalone website automatically imports prepared originals/stems/artwork or available raw inputs. Two-minute renewable claims prevent raw import and separation from taking the same source. Prepared transfer resumes from committed 256 KiB chunks, validates sizes/SHA-256/320 kbps MP3 gapless timing, commits audio/metadata/membership/receipt with strict durability, then acknowledges the immutable capture ID. Failed transactions, damaged transfers and lost acknowledgments preserve the source; repeated acknowledgment does not copy or resurrect audio. A failed song does not block the rest. A raw acknowledgment also cleans abandoned partial output. The schema-3 to schema-4 upgrade retains existing 7.x captures. No new permissions, hidden documents, extra automatic tabs or storage-access prompts.

Validation: 330 tests pass (93 JavaScript + 237 TypeScript), lint and production website/extension builds pass. Fourteen new tests include an actual MP3 encoder round trip with synthetic audio, hosted-worker adapter integration (mock separation), concurrent capture completion, cancellation, source validation, claim expiry/replacement, upload retries, damaged imports, commit rollback, lost ack resume, immutable result IDs, sender restrictions and old queue upgrade. These are not a live Spotify/GPU test or a 3 GB Chrome transfer benchmark. Reload extension 7.3.0 and Spotify for the final real-capture check; old 7.1 live results do not validate this version.

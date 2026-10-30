# Standalone library verification — 2026-10-29

## Implemented

The website now owns canonical originals/stems, metadata and collections in a fresh `ktv420-web-library-v1` IndexedDB database. Import, catalog, playlist playback, the existing effects/visualizers and replay use website storage directly. The optional 7.0.0 extension exposes Spotify discovery and one-song precise capture, with a separate durable temporary queue. No website iframe or general storage/API broker remains.

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

The unpacked extension must be manually reloaded after installing 7.0.0, then Spotify refreshed. Browser automation cannot reload the extension itself. The new real Spotify → website connection, a complete two-song capture, website closure/reopening during a recording, and a full-song listening check have not yet been verified against that installed version. Simulated protocol/queue tests are not represented as live Spotify evidence.

A roughly 3 GB playlist was not imported in this run. The existing streaming ZIP writer, per-song importer and bounded delivery remain; round-trip verification used a small real-audio fixture. Sustained full-song GPU inference while listening, other operating systems and Chrome Web Store review remain separate acceptance checks.

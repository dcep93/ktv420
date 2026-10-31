# Shared website library

The user authorized simplifying the storage architecture after Chrome's extension host-permission exemption was identified. A private Chrome test confirmed bidirectional IndexedDB sharing between a top-level ktv420 page, a Spotify → extension → ktv420 frame, and an extension → ktv420 frame.

## Design

Keep one durable music library at ktv420.web.app. The offscreen hosted worker reads verified captures from the extension's existing temporary transport buffer, commits their original to the website library, separates, and atomically replaces the original with five MP3s in that same library. It acknowledges the temporary extension recording only after the durable ready commit. No new finished audio is uploaded back into the extension or imported on website page entry.

Retain the existing capture transport and exclusive background claims: replacing those would enlarge this change and risk capture timing. Keep legacy prepared-file import solely to recover already stored extension audio and to support extensions not yet reloaded. Recover older website-only unfinished originals through the existing bounded transport once, skipping recordings already queued. Multiple website/overlay pages must never own background inference. The website-wide separation lock protects direct saves, migrations, and deletion.

The overlay remains capture-only and opens playback on the website. Its settings display the same local audio library, including deletion, while unfinished temporary captures remain safely manageable. The UI uses one live status per song, prioritizes a committed ready record, and never shows an import gap for newly separated songs. Existing volume, navigation, layout, and visualizers are unchanged.

## Verification

Test exact raw transfer, direct MP3 commit with no work-begin/work-append output transfer, crash after commit before acknowledgment, canceled inference, failed storage preserving raw input, existing prepared migration, synchronized library/delete views, and offscreen processing while all visible tabs are closed. Run existing tests/lint/build and isolated Chrome with real inference. Verify deployment before installing the updated extension locally. User's live library must not be cleared by tests.

## Results

- Private Chrome: bidirectional IndexedDB access between the actual nested Spotify/extension/website frame arrangement and top-level website.
- Real Demucs CPU inference with every visible tab closed: all five MP3s committed to website storage; temporary extension source removed; no prepared-output copy. Reopening shows Ready immediately.
- Background document killed during inference: replacement acquired work in about 1.1 seconds, recovered the shared original, and completed separation.
- Nested overlay Settings displayed website audio and deleted the same record seen by the website. Track entry stayed paused; X returned track → playlist → catalog; playback advanced with another tab focused.
- 398 tests passed (95 JavaScript, 303 TypeScript), including old prepared-file migration, lost acknowledgment, deliberate deletion, aborted MP3 commit, processing-lock exclusion, and strict durability before acknowledgment. Lint and production builds passed.

No live user Spotify recording or user library was altered by these tests.

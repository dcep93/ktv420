# Audio cleanup rollout — 2026-11-22

Status: fixed and committed locally; candidate built and verified; not pushed or deployed.

## Change

Fix commit: `b88532a880f1a0d73b474deeb5aa24081b95c374`.
Remote main at preparation: `16652fc774c5279186372b49b346d3160c980134`.

Previous-song worklet error handlers kept the decoded audio alive after the player had closed its audio context. The captured Chrome heap contained 32 disposed players. An offline reachability analysis attributed 15.77 GB of audio retention to old worklet listener edges.

The fix clears processor-error and port callbacks, drops engine-owned buffer and graph references, releases the end callback, clears player buffer references on unmount, and disposes partially initialized engines when channel allocation or graph setup fails. Playback, effects, tempo/pitch processing and saved audio formats remain unchanged. There is no storage migration or extension permission/version change.

## Local verification

- 428 automated tests passed (104 extension/script tests and 324 application tests).
- Full ESLint and production website/extension builds passed. The existing large-bundle warning remains.
- Real-browser cleanup fixture: before the fix, 12 replaced players left 72 error handlers and 60 decoded buffers. After the fix, 12 replacements plus cancellation, explicit/idempotent disposal and allocation-failure checks passed. All 65 decoded buffers became collectible: the final observation showed **0 surviving decoded buffers, 0 error handlers and 0 open audio contexts**.
- Native context/worklet wrappers can remain browser-managed after closure. The verified result is release of decoded audio, not a guarantee that total process RSS instantly returns to its initial value.
- Master audio fixture: 21 checks passed at 44.1/48 kHz, including tempo switching and export-tail alignment.
- Export correctness fixture passed: all 16 effects matched their live graphs; tempo/pitch automation, seeks, pauses, continuous MP3 encoding and cancellation checks passed.
- Cleanup regression also passed in a fresh Chrome window: all 20 checks passed and, after garbage collection, all 65 decoded buffers were released, with 0 error handlers and 0 open contexts. Master/export regressions ran in the in-app browser.
- Staged hosting manifest: all 157 assets verified against their hashes; old immutable assets retained for already-open sessions.

Local evidence (outside Git and the deployment payload):

- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-browser-results.txt`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-proof.png`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-chrome-proof.png`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-tests.log`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-lint.log`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-build.log`
- `/Users/danielcepeda/repos/_codex_output/ktv420-cleanup-investigation.json`

## Prepared candidate

Repository: `/Users/danielcepeda/repos/ktv420`.

- Hosted candidate: `site/player/` plus the existing landing site and `firebase.json`.
- Hosting archive: `dist/rollout/audio-cleanup-hosting.tar.gz` (about 45 MB).
- Archive SHA-256: `50791d0d7064da35415c8dcfbc3855c842d339fd5ef8b5cc1cf3402adabf0320`.
- Expected new entry module: `/player/assets/index-B67yrMZP.js`.
- Entry module SHA-256: `105d13ef30ac52cab8941c6b0650618f065856e539d84386afa03f44d3f3dfc9`.
- Entry HTML SHA-256: `ee19f3c86d6b80d21da272a0f2c2b5c0b0b4df2f0932f35907e25fdd2d7e5238`.

The normal packaging script also generated `dist/ktv420-extension.zip`; no extension reinstall or store submission is needed for this hosted-player change. The installed extension was not modified. No heap dump, user audio, development fixture or diagnostic report is in the hosting archive.

## Before publishing

1. In the frontend directory, run `npm run dev -- --host 127.0.0.1` and open `http://127.0.0.1:5174/cleanup-preview.html` in Chrome.
2. Click **Run lifecycle checks**. Require `completed: true`, `failure: null` and all 20 checks. In DevTools Memory, collect garbage, then click **Inspect survivors after GC**. Require zero decoded buffers, error handlers and open contexts. This synthetic test is silent and does not access the music library.
3. Confirm the working tree is clean and inspect `git log --oneline origin/main..main`. Fetch `origin/main` before publishing. If remote main advanced from the preparation base, integrate safely and rerun affected checks; do not force-push.
4. Obtain rollout approval. Pushing main runs `.github/workflows/workflow.yaml` and publishes production automatically. No push was performed during preparation.

## Publish after approval

From the repository root:

```sh
git push origin main
```

Watch the **Build and publish ktv420** workflow through tests, build, immutable-asset retention and Firebase Hosting deployment. Use this normal pipeline as the single deployment route. The saved archive is an independently hashable candidate, not evidence of a completed deployment. CI may rebuild different hashes if its toolchain differs; verify the actual successful workflow's entry module.

## Post-deploy smoke and observation

1. Record the successful workflow commit and Firebase release. Open a fresh KTV420 tab or deliberately reload an idle existing tab. Avoid interrupting an active recording or export. Old loaded tabs retain old code until reloaded; this fix cannot erase their already-attached closures remotely.
2. Verify playback, next/previous song, seek, pause/resume, an effect, tempo and pitch. Repeat at least 20 song changes, then return to the playlist/unmount the player and collect garbage in Chrome DevTools.
3. Require historical full-song AudioBuffers to disappear rather than increase with the number of visited tracks. The current song's buffers and temporary decode copies are expected; process RSS alone is not the acceptance test. Check for new processor errors, disabled Play controls, cut-off tails or export failures.
4. Leave rollout complete only after the fresh Chrome session passes. Saved captures/stems should still be present; no deletion or recapture is required.

## Rollback

If playback or cleanup regresses, restore the immediately preceding Firebase Hosting release through the project's release history. For a lasting source rollback, revert the cleanup commit (not unrelated commits), test/build and publish through the normal workflow:

```sh
git revert b88532a880f1a0d73b474deeb5aa24081b95c374
git push origin main
```

No data migration needs reversal. Refresh affected idle sessions after rollback. Reverting restores the known retention bug, so keep sessions short until the corrected cleanup release is ready.

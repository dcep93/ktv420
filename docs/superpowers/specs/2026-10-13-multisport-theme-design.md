# Compact Multisport theme

Approved by the user with `yesi` on 2026-10-13. Match the canonical Multisport theme specified by `dcep93.github.io/mac/newapp.sh`, without running the scaffolder over this project.

## Appearance and copy

Use the exact Multisport brown background, translucent brown panels, warm borders, white/muted text, amber controls, and pink title. App titles use `--app-title-font`: native Comic Sans with bundled Comic Relief and its OFL license, no remote fonts. Common typography and palette live in one shared theme source used by the landing site and hosted player. Use rem/em for new layout sizes.

Replace the oversized marketing homepage with a compact page: pink `ktv420`, `Listen. Separate. Mix.`, Download, and three short installation steps. Keep storage, model-download and update information in collapsed help. Keep same-folder update guidance and uninstall/storage implications available. Source/checksum links remain accessible.

Apply the theme to hosted player controls, settings, track rows, direct-player guidance, and visualizer picker. Preserve the original compact close/k/settings header and workflow. Shorten stem names to Bass, Drums, Other, Vocals, Original; concise visible visualizer labels retain descriptions as tooltips. Keep accessible control names and meaningful errors. No new presets, mobile work, harmony redesign, audio behavior or processing changes.

## Architecture and compatibility

The existing Spotify launcher already has brown surfaces and a pink k icon. Leave packaged extension code and version 0.4.0 unchanged. This change must work on the deployed v1 bridge and ship through website files only. Captures/stems remain in extension IndexedDB; local Demucs and visuals remain in the hosted iframe. Firebase CSP must allow self-hosted font files. Versioned/hashed asset retention continues to protect existing player sessions.

## Verification

Run existing tests, lint and both builds, inspect packaging for unchanged broker content and no font/player dependencies added to the extension. Browser-check the compact homepage, font fallback loading, settings, playlist, mixer and visualizer selection using the existing synthetic cross-origin fixture. Verify playback after styling, keyboard focus and desktop widths. Save screenshots. Check deployed assets after normal publication; do not claim real Spotify integration was tested through the synthetic fixture.

## Self-review

Scope is presentation and copy only. No storage/protocol changes or new extension permissions. Shared font files need a hosting CSP addition (`font-src 'self'`), and immutable Vite font assets must remain retained. These are included in implementation planning.

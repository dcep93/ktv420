# Persistent mixer settings

Approved: latest visualizer, spotlight, expanded scene, stem volume/mute/lock, effect choice/amount/options, tempo and pitch persist in localStorage and restore on page load. They remain global player preferences within the current browser storage context, not per-song settings. Playback position and playing state are not preferences. Master output volume continues to inherit Spotify.

Use one versioned key, validate saved snapshots and supported effect/visualizer identifiers, and fall back to defaults on missing/corrupt/unsupported data or denied storage access. Load synchronously once before mounting the player. Keep in-memory settings current immediately; debounce disk writes by 150 ms and flush on pagehide, hiding the document, and unmount. Avoid overwriting a saved mix during loading or replay/export automation.

Separate a testable storage controller from the React lifecycle hook. Reuse existing MixerSnapshot, settingsForTracks, and onSettingsChange paths. Expanded scene state lives beside the snapshot. Invalid storage must never prevent playback or settings changes. No extension permissions or remote synchronization.

Verify complete round-trip, latest-write debounce and flush, corrupt/unknown values, unavailable storage, reload with the real player controls, and replay isolation. Run full tests/lint/build and verify deployment. Self-review: requirements covered; no auto-play restoration; no changes to captured audio or recording format.

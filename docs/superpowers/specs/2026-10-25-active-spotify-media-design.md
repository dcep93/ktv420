# Active Spotify media selection

The user approved fixing capture's rejection of two loaded media elements. Preserve the existing monitoring mute policy and select the same source for capture, listening state and tempo.

Use the unique playing, non-ended, usable element. If none are playing, accept only a single usable non-ended element, preserving capture setup before playback. Do not use volume or mute to select a source. Ignore ended and unloaded media. When ambiguous, wait within the existing capture timeout for a transition to settle, then report the playing and loaded counts. Never pick the first element or mix sources.

Keep selection inside the page-world hook so it can see detached Spotify media. No new permissions, cloud operations, storage changes or hosted player changes. Package extension 6.3.3 and update the existing unpacked installation in place.

## Follow-up: Spotify Canvas playback (6.3.4)

The user's live Spotify page contains a looping 7.799999-second video while the song timeline is 258.391 seconds. Both can report playing, so playback state alone is insufficient. Filter candidates by the now-playing slider's song duration (within two seconds), then use its accessible position when multiple durations match. Read the displayed clock rather than the range value, which was rounded to five seconds while the displayed clock read two seconds. Reread this DOM evidence during bounded transition waits. If the timeline is unavailable, exclude looping video; retain the existing conservative ambiguity handling. Full-length music videos remain eligible.

Apply monitoring gain only to the selected source, since the play hook may have created graphs for decorative videos too. Add regressions for simultaneous Canvas and song playback, paused songs with playing decorations, equal-duration clock selection, remaining genuine ambiguity, full music videos, transition timing, and isolated monitor output. Update the existing unpacked install to 6.3.4; real capture confirmation still requires extension and Spotify reloads.

Verification runs the shipped hook in a mock browser through its command bridge. Cover active + paused preload, mute-independent selection, ended/unloaded exclusions, multiple playing and paused sources, transient overlap and sequential track captures. Run the full tests, lint, build and packaging checks. Real Spotify behavior requires reloading the extension and Spotify; unit tests do not prove live Spotify compatibility.

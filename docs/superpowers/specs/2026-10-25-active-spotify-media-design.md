# Active Spotify media selection

The user approved fixing capture's rejection of two loaded media elements. Preserve the existing monitoring mute policy and select the same source for capture, listening state and tempo.

Use the unique playing, non-ended, usable element. If none are playing, accept only a single usable non-ended element, preserving capture setup before playback. Do not use volume or mute to select a source. Ignore ended and unloaded media. When ambiguous, wait within the existing capture timeout for a transition to settle, then report the playing and loaded counts. Never pick the first element or mix sources.

Keep selection inside the page-world hook so it can see detached Spotify media. No new permissions, cloud operations, storage changes or hosted player changes. Package extension 6.3.3 and update the existing unpacked installation in place.

Verification runs the shipped hook in a mock browser through its command bridge. Cover active + paused preload, mute-independent selection, ended/unloaded exclusions, multiple playing and paused sources, transient overlap and sequential track captures. Run the full tests, lint, build and packaging checks. Real Spotify behavior requires reloading the extension and Spotify; unit tests do not prove live Spotify compatibility.

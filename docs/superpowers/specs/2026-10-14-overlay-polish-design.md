# Overlay polish and track progress

Supersedes the previous centered-list anchoring requirement: reserve a status slot above a permanently positioned close / k / settings row, with playlist, settings, and player content scrolling below. Preserve warm dark Multisport styling and concise copy. Keep independent scroll positions for each view; opening a new song starts its player at the top.

Replace emoji and checkboxes with consistent rounded SVG icons. Only fully saved, ready songs are interactive, including keyboard and next/previous navigation. Waiting artwork is grayscale; ready artwork returns to color. Settings briefly explain pausing separation, the downloaded model, and local audio. Preserve existing confirmation and concurrency safeguards for deletion.

Capture fills the current song row in pink using Spotify playback position divided by duration, throttled to 250 ms through existing capture polling. Unknown duration is indeterminate; stop, error, storage completion, and cached skips clear progress. Pass an optional validated captureProgress object through the existing authenticated v2 broker. Older installed brokers remain compatible without capture percentages. Package the telemetry update as extension 6.0.2, with unchanged permissions and install path.

Separation fills its row in amber. Use real chunk progress with an approximate stage weighting: separation occupies 0–90%, MP3 saving 90–99%. Keep progress monotonic through output resampling. Model preparation and work in another view use an indeterminate pulse. Only a successful stored ready state removes the progress indicator and enables playback. Respect reduced motion; expose textual statuses as well as color.

## Verification

65 automated tests passed, plus lint and hosted/extension production builds. Added capture polling/reset/invalid-timing tests, optional broker field validation, and monotonic separation-progress tests. Isolated Chrome checks at 1440×1000 and 1100×720 verified fixed control coordinates across short/long playlists, errors, settings, and player; independent scroll restoration; disabled hover/keyboard/click behavior; capture fill and clearing; separation phase transitions; actual MP3 encoding/storage after a mocked inference result; ready-state color and playback eligibility. No page errors. Browser checks use synthetic Spotify metadata/audio and controlled inference progress, not a fresh real Spotify capture. Existing capture audio logic and inference worker are unchanged.

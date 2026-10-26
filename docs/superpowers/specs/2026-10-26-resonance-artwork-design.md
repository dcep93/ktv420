# Resonance Plate artwork

Replace the unrelated standing-wave pattern with a stable grain portrait of the current album cover. Preserve the four stem colors: gold, brown, pink and teal. Artwork controls grain placement, luminance and strong edges; seeded noise controls color distribution. Slowly crossfade color assignments using playback time, never move the artwork contours. Each separated stem drives only its own color; mute removes that color. Original never contributes, either alone or alongside stems.

Analyze a bounded thumbnail once per artwork change, preserving aspect ratio. Include RGB contrast in edges so equally bright different colors retain their boundary. Missing, unreadable or CORS-blocked artwork uses a drawn double music note. Cancel stale loads on track change. Only load for Resonance Plate; a late load must redraw when paused. Do not change other visualizers or extension code.

Validate edge location and contrast, deterministic placement, fallback and late/canceled image loads; retain mute/solo/pause/seek tests and bounded drawing. Inspect real browser artwork and fallback at compact and full height, measure rendering cost, then deploy the hosted change.

Opacity adjustment: apply a fourth power to the initial opacity (square the already-squared result again), retaining fully bright peaks at 1. Relative to the previous squared version, .5 becomes .25 and 1 stays 1. The shared color helper uses a power curve, so squaring its input squares its output as well. Apply this only to Resonance Plate; retain grain geometry and the other scenes' brightness.

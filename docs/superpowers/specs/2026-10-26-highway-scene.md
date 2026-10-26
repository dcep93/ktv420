# Highway: one shared neon desert drive

The user requested improving Highway and making it one combined scene like
Stem Weather. Preserve the road, sunset and cacti identity, but replace the
old per-panel renderer with shared perspective and restrained visual motion.

One canvas combines the audible, post-effect stems: drums light roadside
markers, bass illuminates road edges, vocals animate a sliced sun and its
waveform, and other fills mountain silhouettes and passing cacti. Keep a quiet
base road and stars when muted; each stem's contribution follows its fader and
clears on mute. Original-only audio can drive the scene too.

Use a deterministic, bounded renderer, capped Retina canvas scaling, shared
analysis buffers, and playback time. Pauses stop travel; seeking resets travel
without spawning a backlog. Preserve the highway identifier for recordings and
the combined-scene behavior for layout/spotlight. Remove the superseded renderer.

Verify perspective, finite/bounded drawing, mute/solo, pause/seek, and existing
replay identifiers. Inspect the production renderer in the browser with synthetic
stems at wide and compact sizes. Run tests/lint/build and deploy the hosted UI.

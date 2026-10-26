# Four combined scenes

Approved: add Signal Loom, Ink Tank, Resonance Plate and Glassworks. Keep Hollow Echoes. Remove Delay Pedal from the visualizer picker, preserving old replay support and the separate Echo audio effect.

Each scene uses the shared combined panel, including its click/keyboard 100vh toggle. Post-effect audio analysis drives independent stem contributions; muted layers disappear immediately. Original audio has its own contribution. Use fixed budgets, reusable state, song-time motion, bounded history, explicit seek resets and the existing hidden-canvas scheduling.

Signal Loom weaves flowing luminous threads with drum cross-stitches and a short sampled energy history. Ink Tank draws advected ink filaments and small suspended particles using bounded analytic flow, rather than a costly fluid solver. Resonance Plate draws frequency-driven nodal sand patterns, interpolated smoothly; it is a cymatics-inspired artwork, not a measurement. Glassworks uses a deterministic irregular triangular glass mesh with stem-owned panes, slow illumination and transient seams.

Verification: renderer operation budgets at compact/full-height dimensions, all stem solos/mutes, pause geometry, seek resets, registry/replay compatibility, browser inspection and frame submission timings. Run tests/lint/build, push and verify deployed assets.

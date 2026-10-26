# Visualizer ordering and motion refinements

Put Signal before Scenes before Patterns. Signal order: Time Ribbon, Super Time Ribbon, Waveform Waterline, Spectrum Safari, Laser Ladders, Hollow Echoes, Mirror Peaks, Pulse Grid, Stereo Bloom, Nebula Trails, Cascade Horizon, Spectrogram. Highway is the first Scene, followed by Beach and the remaining existing scene order. Preserve saved IDs, selection and common-width layout.

Rock Show becomes an abstract concert lighting rig: retain trusses, moving beams, haze and bass washes; remove stage, speakers, instruments, performers and audience silhouettes. Extend the lighting into the freed space and update its picker description and bass legend.

Resonance Plate keeps its four stem colors and original exclusion, but removes the fixed brightness floor and bypasses the shared quiet-detail boost. Use actual alpha = stem level cubed: silence 0, midpoint .125, full peaks 1. Retain artwork contours and grain geometry. Raising the existing exponent alone would leave an artificial floor; a global gain reduction would sacrifice peaks.

Kaleidoscope retains music-driven drift with substantial inertia. Replace quick onset zoom pulses with multi-second smoothing of energy, bass, zoom and angular/orbital speed. Integrate the smoothed velocities, preserving frame-rate consistency, freeze on pause/mute and seek continuity. Simply reducing speed would not remove rapid zoom changes.

Verify signal order visually, Rock Show without silhouettes, plate low-level darkness/peak opacity, and Kaleidoscope motion across attacks, pauses, seeks and frame rates. Run relevant tests, lint/build, browser synthetic previews, then commit, push and verify deployed bundles.

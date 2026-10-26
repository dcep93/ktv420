# Pitch Ribbon clarity

Approved design: active passages remain clearly visible, silence creates gaps, colors follow the same audio-driven palette as Time Ribbon, tonal passages track approximate fundamental pitch, and each panel gently fits its recent pitch range with a minimum two-octave span. No instrument-name rules.

Use a bounded time-domain periodicity estimator on an approximately 85 ms waveform, downsampled for display analysis. Reject uncertain periodicity and fall back to spectral register for unpitched/polyphonic audio. This remains a visualization, not transcription. Keep audio processing untouched. Restore the normal analyser window outside Pitch Ribbon.

Separate pitch estimation from history/rendering. Sample at 20 Hz, reuse scratch buffers, preserve pause/seek/hidden-canvas behavior, and retain a bounded 20-second history. Store pitch in octaves so range adjustments do not alter historical measurements. Use a short pitch response rather than the existing 180 ms smoothing. Fit robust recent pitch bounds with gentle range movement. Silence is independent of pitch confidence; unpitched but audible signals should still appear.

Opacity uses a soft near-silence gate and compressed loudness above it. Active quiet passages should be at least 80% opaque; true silence must disconnect the path. Use Time Ribbon's shared spectral hue and smoothing, storing color with each sample. No new controls or changes to other visualizers.

Verification: generated low melodies, weak/missing fundamentals and changing harmonics, gain changes, noise, silence, accurate semitone motion, opacity, range response, bounded history, pause/seeks, production sample rates. Browser fixture must show multiple anonymous signals, gaps, distinct colors, melody movement, and timing measurements. Full tests, lint, build, commit/push and hosting verification.

Self-review: no track-name dependence; no audio graph/output changes; estimator scratch bounded; other views restore analyser size; no new UI text. All requested changes covered.

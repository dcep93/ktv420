# Pitch Ribbon

The user requested a single-line pitch time series, volume as opacity, immediately after Super Time Ribbon. Render per stem through the existing signal visualization path. Estimate general pitch with the energy-weighted logarithmic frequency center, which stays defined for chords and noisy instruments; this is an approximate register, not a fundamental-note detector. Display 20 seconds of live post-effects history, with newest audio at the right edge. Use a fixed logarithmic axis, gentle smoothing, and RMS-controlled opacity. Silence creates gaps. Freeze on pause, reset on seeks/visibility gaps, cap retained points, and reuse analysis buffers. No extension update, new UI controls, or audio graph changes.

Validation: synthetic spectra and waveform levels, octave mapping, silence, history lifecycle, all-renderer geometry audit, real browser synthetic preview, tests/lint/production builds.

# Octave, Reverse Echo, Shimmer Reverb

Approved by the user: implement all three proposed effects and place them in a sensible order. Preserve the existing compact controls, no panning or bypass UI. Append stable effect IDs to preserve worklet compatibility and recorded names. Octave follows Saturation; Reverse Echo follows Echo; Shimmer Reverb follows Reverb. Octave uses a bipolar blend (down / dry / up); the others use zero as dry. Reverse Echo shares BPM and beat settings, which set the reversed phrase length. Settings, effect changes, and amounts must work through existing recordings, replay, and MP3 export.

Use the existing allocation-free stereo DSP worklet, with bounded preallocated delay storage. Octave uses a phase-vocoder with preallocated FFT buffers, measured phase increments, overlap-add synthesis, and rejection above Nyquist; the dry source stays immediate. Reverse Echo plays overlapping, windowed slices of past input backwards; it cannot anticipate future audio. Timing changes apply at grain boundaries, with window normalization to avoid abrupt changes. Shimmer layers octave-up processed reverb with the existing diffuse tail, without a pitch-feedback loop that can run away. Preserve stereo and exact neutral output.

Validation: existing audio tests plus octave frequency/alias measurements, reversed marker order, audible wet output, finite decaying shimmer tails, controls at production sample rates, stereo isolation, replay acceptance/determinism, real browser worklet/export checks, and five-stem processing benchmarks. No live Spotify playback or user recordings are needed. Build, commit, push, verify deployment; no extension update is needed.

Technical references: Julius O. Smith, Delay-Line and Signal Interpolation (https://dsprelated.com/freebooks/pasp/Delay_Line_Signal_Interpolation.html); Julius O. Smith, Phase Vocoder (https://www.dsprelated.com/freebooks/SASP/Phase_Vocoder.html).

## Verification results

Production browser worklets produced correctly tuned octave-up/down layers in both channels. All three new effects passed replay/export rendering checks with scheduled amount changes. Five simultaneous stereo stems, 8 seconds at 48 kHz, median of three offline runs: existing Reverb 426 ms, Octave 1,033 ms, Reverse Echo 334 ms, Shimmer 1,205 ms. These are offline wall-time measurements, not live CPU percentages. Pitch shifting is an effect layer with roughly one analysis window of wet latency; the dry source remains immediate.

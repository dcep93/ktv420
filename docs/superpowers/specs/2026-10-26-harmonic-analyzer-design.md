# Harmonic analyzer accuracy and responsiveness

Replace the brute-force, aliased mono Goertzel scan with a stereo-energy FFT analysis using the existing FFT implementation. Analyze the original captured audio at its native sample rate, preserving opposite-polarity stereo. Use centered subsecond windows, spectral peaks with interpolated frequencies, robust global tuning, harmonic suppression, and chord templates that require evidence for every named note. Correct add9 versus ninth labels and prefer Unclear to inventing harmony for silence, noise or isolated notes. Short temporal smoothing must preserve silence and real changes.

Run DSP in a dedicated worker. Transfer only bounded window batches, not a duplicate full song, and expose progress and cancellation. Stop the worker on cancellation or track change; stale results must not update the new track. Keep the existing compact chord line and scan button, replacing the running button with Cancel scan. Display chord names without the repeated A4 reference-frequency text. Confidence is a heuristic, not a calibrated probability. Continue labelling untransposed results as source chords when pitch-shifting playback.

Re-run must bypass cache, and bump the analyzer version so older results are recomputed. Retain local-only processing and cache storage. Do not add model downloads, key/Camelot UI, panning or automatic playback changes.

Alternatives: tuning the existing scorer cannot fix aliasing, cancellation and thread stalls. A learned chord model would add downloads and validation complexity. A bounded spectral approach is the appropriate improvement now, while real mixed music remains more ambiguous than synthetic chords.

Validate major/minor chords in all keys, sevenths/add9, inversions, tuning deviations, rich harmonics, silence/noise/single notes, stereo polarity, quiet gain changes, chord-change timing, sample rates, cancellation and monotonic progress. Compare the old/new implementations on the same labelled synthetic progression and measure scan time. Verify the actual worker in a browser, then tests/lint/build and hosted deployment.

Method references: AudioLabs FMP chord template and tuning notes (https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S2_ChordRec_Templates.html), and the original NNLS Chroma authors' discussion of tuning and harmonic-note separation (https://isophonics.net/nnls-chroma). The implementation is a lightweight independent spectral approximation, not Chordino.

## Validation results

- All 205 tests pass (46 extension/scripts, 159 frontend); lint and production build pass.
- Signal tests cover all 12 major/minor roots and first inversions, extended chord spelling, detuning, wide voicings with percussion, native sample rates, phase-inverted stereo, silence/noise/DC, transition timing and pre-aborted requests.
- On a labelled 12-second synthetic progression, midpoint recognition improved from 2/6 to 6/6 chords; the synchronous reference scan took about 35 ms versus 1.7 seconds previously. This is a controlled regression benchmark, not measured real-song accuracy.
- The actual browser worker passed progress, cancellation, restart and playback-buffer preservation checks. A five-minute stereo synthetic scan took 3.21 seconds, with a measured maximum main-thread heartbeat gap of 5.4 ms on the development machine. These are observations, not hardware-independent guarantees.
- The actual Player loaded a seeded current-version cache, then replaced it on Re-run. Switching tracks cleared the prior result and allowed the next track to analyze normally.
- `harmony-preview.html` provides the development-only reproducible browser fixture; it is not included in the hosted production entry points.

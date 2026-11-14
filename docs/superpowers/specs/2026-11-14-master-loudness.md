# Master loudness

Approved by the user's “implement and deploy” instruction on 2026-11-14.

## Behavior

Add one native DynamicsCompressorNode followed by a memoryless soft safety ceiling after summing the stems, before the existing listening-volume GainNode. Existing faders provide boost. Keep all individual effects, capture, stored audio, and extension behavior unchanged. Apply the same mastering graph to offline performance exports. Quiet audio remains linear apart from the compressor's native automatic makeup gain; strong boosts compress/saturate instead of producing unbounded output.

Start with threshold -6 dB, knee 6 dB, ratio 12, attack .003 s, release .15 s. Tune only if measured signals expose poor peak/loudness behavior. The safety ceiling is linear below .75, then approaches 10^(-1/20) using tanh. A native WaveShaperNode with oversample='none' and a scaled input domain avoids another buffering stage. Use a large symmetric curve, with domain [-32,32], and input attenuation 1/32; out-of-domain samples saturate safely. This is sample-peak protection, not a true-peak or lossless-compression claim.

## Timing and lifetime

The native compressor adds floor(sampleRate * .006) frames in Chromium. Represent that in one shared helper; validate with browser impulse rendering at 44.1/48 kHz. All stems enter one compressor and keep their relative alignment. Do not change recording/transport timestamps to presentation timestamps. Visual song positions use the master-delayed clock, accounting for tempo and scheduled starts. Delay per-stem analysis branches by the same amount, with a silent sink so they cannot duplicate audible output. This compensates the new master delay; existing device latency remains outside this change.

Offline renders allocate the delay's extra frames, render the final delayed samples, and remove only the master delay, preserving the original section frame count and existing transport start scheduling. Defer live natural-end notification by the master delay to avoid truncating the final samples. Dispose graph nodes and analysis branches when their owners are removed; no new persisted setting or recording schema.

## Validation and delivery

Unit tests cover ceiling linearity, symmetry, bounds, gain mapping and presentation-clock behavior through tempo changes/seek/start. Native browser OfflineAudioContext checks measure delay, silence, peak ceiling, a boosted representative signal's RMS, stereo alignment and export duration/final samples. Run existing tests, lint and build; review the diff. Commit task changes on main and push, wait for GitHub Actions Firebase deployment, then verify the hosted asset references. No extension reinstall or version bump.

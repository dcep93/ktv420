# Master loudness verification — 2026-11-14

The hosted player now routes its summed stems through one native DynamicsCompressorNode and a memoryless safety ceiling, before listening volume. The extension and captured/stored audio are unchanged. Existing stem faders supply boost; the compressor also provides native automatic makeup gain.

Chrome OfflineAudioContext measurements using `master-preview.html`:

| Sample rate | Master delay | Delay in milliseconds |
| --- | ---: | ---: |
| 44,100 Hz | 264 frames | 5.9864 |
| 48,000 Hz | 288 frames | 6.0000 |

Both rates passed stereo impulse alignment, exact silence, opposite-stem cancellation before nonlinear processing, finite extreme-input output, and a sample peak ceiling of 10^(-1/20). A 0.15-amplitude 733 Hz sine measured about 0.13559 RMS at unity and 0.522 RMS with 4× input gain (+11.71 dB relative to unity). This is a synthetic signal result, not a promise of equivalent loudness gain on mastered songs. Native waveshaper interpolation has about 1.91e-6 maximum opposite-polarity rounding error in the extreme-input test.

The master fixture's sparse export markers verified removal of only the added master delay, preservation of the existing 20 ms scheduled start, exact two-second section length, final-marker retention and stereo alignment. The export fixture matched native reference graphs sample-for-sample across all 16 visible effects, including Underwater. It also passed pause/resume/seek, independent and automated tempo/pitch, fader automation, exact two-song MP3 length, and rendering/encoding cancellation with scratch-file cleanup.

Visual timeline queries use a recent history of tempo changes rather than subtracting a fixed amount of song time. Per-stem analyser taps receive the same master delay, in silent branches; they do not duplicate audible output. Recording and transport clocks retain source time. Live natural-end notification includes the master delay.

Limits: the safety ceiling bounds rendered samples, not reconstructed analog peaks or all peaks after lossy MP3 encoding. Intentional effect delays and phase changes remain. The new master delay is compensated; existing operating-system/device output latency is not calibrated by this change. Offline tests do not replace subjective listening tests on music.

Delivery checks: all 413 automated tests passed (97 extension/script tests and 316 application tests), ESLint passed, and the production website/extension build passed. The native master fixture passed 21 checks, including tempo toggles during the scheduled start lead-in. A real Player browser smoke test passed readiness, play/pause/resume and natural ending, and observed exactly one compressor, one ceiling node and five silent delayed analysis branches. Independent spec and code-quality reviews found no actionable issues.

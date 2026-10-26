# Effects rebuild

The user approved the full effects improvement proposal, excluding all panning.
They clarified that envelope-following effects are wanted; only automatic panning
is excluded. Keep the compact per-stem controls and local processing.

Replace the shared, repeatedly disconnected effect graph with a stereo DSP engine
in one AudioWorklet per stem. Share the exact processor between playback and
OfflineAudioContext export, with a pure DSP core exercised by signal tests. One
bounded set of delay/filter states per stem; no buffer regeneration while dragging.
Effect changes fade through dry sound; amount and bypass changes are smoothed.
Modulation is tied to song time on play/seek for consistent replay. No panning.

Rebuild Wah with bounded resonant gain; Echo with a separate manual BPM / beat
interval, darkening feedback and controlled repeats; Reverb with a stable diffused
feedback network and damping; Chorus with independent stereo delay modulation;
Flanger/Phaser with bounded feedback; Saturation with compensated drive; Envelope
Filter with attack/release loudness following; Formant Filter with three vowel
resonances. Retain Telephone. Consolidate Warm/Lo-Fi/Submerge into DJ Filter and
Bass Boost/Bright/Tilt EQ into Tone; hide redundant Band Emphasis from new choices.
Keep old IDs accepted through explicit compatibility mappings. Older recordings
remain playable but use the improved sound; do not promise old sonic identity.

Keep an effect selector and amount slider, add neutral/value text and bypass.
Only Echo shows BPM and beat timing. Store bypass/timing as optional per-stem
snapshot settings, validated for replay and carried between songs. Old snapshots
use defaults. Tempo-adjusted echo follows the manually supplied BPM; no automatic
BPM claim or tempo detection. Existing extension bridge accepts these snapshots.

Validation: full tests/lint/build, signal tests for transparency, bounded gain,
stereo differences, envelope response, echo timing/damping, reverb tails, finite
stress output and deterministic replay. Use the actual browser worklet in live
and offline contexts, check the UI/recording round trip, measure processor cost,
and deploy through the existing CI workflow. No extension permissions or model
changes. No pan, auto-pan, new scenes or unrelated UI redesign.

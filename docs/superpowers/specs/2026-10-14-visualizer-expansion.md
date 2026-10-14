# Visualizer expansion

Approved scope: add Stem Weather, Spectrogram and Stereo Bloom; keep every existing visualizer. Improve capped Retina rendering, shared background/font treatment, repeated timestamps, buffer reuse and hidden-canvas work. No scenes, harmony work or extension changes.

Stem Weather uses one combined canvas above the compact existing stem controls. Four named stem contributions respond to post-effect audio: drums produce strikes, bass broad low waves, vocals a luminous thread, other an atmospheric field. Muted/solo-excluded stems disappear. Original playback has its own neutral ambience rather than being falsely decomposed. The view remains compatible with recorded visualizer selection. Selecting Weather exits per-track spotlight; replayed Weather also ignores per-track spotlight.

Spectrogram shows logarithmic frequency against recent playback time, colored by level. It uses bounded offscreen history, resets on seeks/track changes, and freezes while paused. Stereo Bloom uses actual post-effect left/right audio, a center spine and mirrored side energy. Analysis nodes are side taps and never add audio to the output. Attach stereo taps only for Bloom and dispose on mode/track changes.

All canvases render in CSS-pixel coordinates with a device-pixel-ratio cap of 2 and a per-canvas pixel budget. Theme background and inherited font replace hard-coded panel surfaces; artwork palettes remain intact. The transport retains the single timestamp. Cached typed arrays avoid repeated analyser allocation. Hidden/offscreen canvases and hidden documents skip drawing. Paused graphs get a short settling period for audio tails, then stop redundant drawing.

Validation: pure helpers for dimensions, frequency mapping and stereo geometry; browser fixtures for synthetic mono/side signals, mute/solo, seek/pause history, resize/spotlight, replay mode selection, and real graph playback. Measure actual player frame rate with tempo/pitch enabled and compare to the existing approximately 60 FPS fixture baseline. Lint, tests and production builds must pass before commit/push/deploy. No extension update.

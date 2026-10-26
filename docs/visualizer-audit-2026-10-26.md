# Visualizer quality audit — 2026-10-26

Reviewed all 30 choices in source and a synthetic browser gallery. Tested geometry/state invariants for every legacy per-stem renderer; existing tests cover the modern combined scenes, spectral/stereo analysis and Retina sizing. Browser previews use synthetic signals, not a representative listening session or a claim of uniform performance on every device.

The strongest direction is the combined scene: each stem has a readable contribution, silence/mute has meaning, and composition works at a large size. The older catalog has too many related rings/waves, some arbitrary spectral bins, and several effects whose motion conveys time more than the music. Keep a smaller set of distinct experiences rather than giving every one a new coat of glow.

## Changes implemented in this pass

- **Super Time Ribbon:** fixed source-envelope vertices and smoothed energy-weighted color shared with Time Ribbon. Motion is bounded and smoothed, with a stationary playhead/grid; no resampling flicker or loudest-bin color jumps.
- **Highway:** coordinated sky/sun/road/desert palette with eased, sixty-second color transitions; subtle deterministic twinkle. Pauses freeze the scene and seeking maps to the corresponding palette. The five-minute palette cycle traverses amber, teal, blue, violet and rose rather than staying pink.
- **All five combined scenes:** click/Enter/Space toggles a panel occupying exactly 100vh, including its legend, in normal document flow. It does not invoke browser fullscreen. Existing Escape behavior still closes and pauses the overlay.
- **Spectrum Safari:** smoothed spectral-centroid color replaces abrupt winning-bin selection; the spectrum fill closes to its baseline rather than cutting diagonally across the plot.
- **Cascade Horizon:** stable seeded star positions replace new random coordinates each frame.
- **Ectoplasm:** continuous spark trajectories replace a discontinuous time-varying hash.
- **Laser Ladders:** bounded log-distributed bands fill the actual panel; bar height scales with its height. Previously most bars were drawn beyond the canvas, with a fixed 127-pixel height ceiling.
- **Kaleidoscope:** canvas-local pointer tracking and time-based easing replace page coordinates and per-frame easing. Starting offsets are deterministic.

## Catalog decisions

| Visualizer | Assessment / next improvement |
| --- | --- |
| Time Ribbon | Keep: useful time context, stable geometry and restrained color. |
| Super Time Ribbon | Keep: fixed in this pass; expressive counterpart with stable reference lines. |
| Stem Weather | Flagship: readable whole-mix contributions. Tall view now supported. |
| Night City | Keep: strong composition. Next, crossfade window patterns and emphasize detected onsets instead of changing the pattern on a fixed three-Hz clock. |
| Stem Garden | Keep: distinct organic composition. A longer evolving growth envelope could improve extended listening. |
| Orbit | Keep: distinct whole-mix arrangement. Background constellations could change slowly over long sessions. |
| Highway | Flagship: coherent perspective and slow palette evolution; larger view works well. |
| Spectrogram | Keep: strongest analytical option. Optional Hz guides would make it more useful without permanent clutter. History is deliberately bounded. |
| Stereo Bloom | Keep: actual left/right signal, not a fake width animation. A brief fading trace could improve readability. |
| Laser Ladders | Keep: fixed scaling and frequency distribution in this pass. Next, short peak holds with a time-based release. |
| Spectrum Safari | Keep: color stabilized. A log-frequency x-axis would expose bass/mids more clearly. |
| Waveform Waterline | Improve next: trigger-align the waveform so sustained tones stand still rather than sliding with arbitrary FFT-window phase. |
| Aurora Radar | Keep provisionally: restrained compact view, but use logarithmic bands for clearer musical mapping. |
| Mirror Peaks | Keep provisionally: clean symmetry. Rebucket and peak-hold consistently with Laser Ladders. |
| Pulse Grid | Improve: rows currently repeat the same frequency values. Give rows actual recent history or distinct frequency ranges. |
| Luminous Orbit | Overlaps radial designs; keep until a smaller curated catalog is chosen. Needs clearer bass/mid/treble roles. |
| Prism Bloom | More elaborate but similar to Luminous Orbit. Reduce ornamental halos before adding more elements. |
| Cascade Horizon | Star flicker fixed. Next, decimate the eight 1,024-point ridges and scale depth with panel height. |
| Nebula Trails | Improve next: it clears the frame before its translucent fill, so it does not retain real trails. Add bounded time-based history or rename it. |
| Echo Lantern | Keep provisionally: pleasant radial display, but repeats visual vocabulary already covered by Orbit and Prism Bloom. |
| Ember Mandala | Keep: distinct petal composition. Match onset response to the combined-scene envelope model. |
| Hippie Mirage | Keep: intentionally psychedelic. Simplify overlapping layers for legibility at compact size. |
| Hollow Echoes | **Propose removal:** another small bar display, less readable than Laser Ladders; the “Harmonic cavities” label overstates what its bin averages measure. |
| Opal Current | Keep: layered flowing waveform. Trigger alignment and fewer glow passes would improve steadiness/performance. |
| Solstice Waves | Keep: recognizable scenic composition. Scale fixed-amplitude geometry with height for expanded per-stem spotlight. |
| Ripple Weave | Keep: relatively clear waveform variation. Trigger alignment would help sustained notes. |
| Ectoplasm | Spark jitter fixed. Next, integrate energy-dependent angular velocity rather than multiplying the entire song time by current energy; this avoids large turns when energy changes late in a song. |
| Prismatic Turbine | Keep for high-energy listening, but slow its three-second hue cycle and smooth energy-driven angular offsets. |
| Kaleidoscope | Pointer/easing fixed. Strong distinct identity; audit touch-free energy motion separately before increasing sensitivity. |
| Delay Pedal | **Propose removal:** colorful waveform cells and rings, but no actual delay history; confusing beside the real Echo audio effect. |

Removal is only a proposal. If approved, remove the choices from the picker but retain their recorded IDs for existing replay files.

## Four proposed additions — not implemented

1. **Signal Loom:** one combined fabric. Vocals and other draw flowing threads; bass stretches the weave; drum onsets add short cross-stitches. Keep a bounded history so patterns show the mix over time. Muted stems stop adding their threads.
2. **Ink Tank:** four translucent inks in a dark fluid chamber. Bass drives slow circulation, drums produce small jets, vocals draw ribbons, and other supplies diffusion. Use a bounded low-resolution simulation, with a measured CPU/GPU budget before shipping.
3. **Resonance Plate:** a cymatics-inspired sand surface. Frequency-band energy selects/interpolates stable nodal patterns; drums disturb particles, bass changes large-scale symmetry, vocals sharpen fine detail. Describe it as frequency-reactive art, not a physical/acoustic measurement.
4. **Glassworks:** a slowly evolving stained-glass mosaic. Each stem lights its own connected cell family; transients send light across borders, sustained notes hold a soft glow. Deterministic topology and restrained illumination keep it readable rather than flashing random tiles.

All four should start as combined scenes with mute/solo/fader fidelity, the shared full-height toggle, deterministic seek behavior and capped rendering cost. Do not add all four before proving that each earns its place beside the strongest existing scenes.

## Validation

153 tests pass, including new Super Ribbon smoothing/pause checks, Highway palette continuity across minute/wrap boundaries, and every legacy renderer's finite coordinates and balanced save/restore at compact and large sizes. Browser inspection verified an 800px panel at an 800px viewport, click and keyboard expansion/collapse, all gallery groups, and the revised Highway palette. Expanded Highway's synthetic drawing/analysis measured approximately 0.84 ms mean / 1.30 ms p95 at 1359 × 765 CSS pixels (CPU command generation, not total compositor cost). Production build/lint and deployment are recorded in the task result.

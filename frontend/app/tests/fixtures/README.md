# Original Demucs reference

`demucs-reference.f32` is a synthetic test fixture, not recorded music. Layout: four stems (`drums,bass,other,vocals`), two channels, 44,100 samples each; little-endian IEEE Float32. It is generated from original PyTorch Demucs 4.0.1's `get_model('htdemucs').models[0]`, not from the browser ONNX model under test.

Input is the exact one-second stereo signal constructed in `src/benchmark.ts`: left = 0.2 sin(220 Hz) + 0.1 sin(997 Hz), right = 0.17 sin(330 Hz), stored as Float32. Apply the whole-recording conditioning defined in `conditioning.ts`, pad both channels to 343,980 samples, run one original model forward pass without time-shift augmentation, crop to 44,100 samples, restore global scale/mean, and write all four stereo stems as Float32. The browser harness compares every output sample, with a conservative 0.001 maximum absolute error threshold. See `docs/browser-validation.md` at repository root for measured errors.

This fixture is served only during development. It is not an extension build entry and is not copied into the extension ZIP.

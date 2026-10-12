# ktv420

A desktop Chrome extension for local four-stem music separation, listening and DJing.

[Install ktv420](https://ktv420.web.app). No server or container is required. Audio stays in the extension's local library; only model weights are downloaded. GPU inference uses WebGPU with a CPU/WASM compatibility option.

## Develop

Node 22+ and Chrome 121+ (latest stable recommended):

```sh
cd frontend/app
npm ci
npm test
npm run lint
npm run build
cd ../..
node scripts/build-extension.mjs
```

Load `dist/extension` at `chrome://extensions` using **Developer mode → Load unpacked**. Click the toolbar icon. Reload Spotify after installing. Rebuild and use the extension's Reload button to update, keeping the same path and installation to preserve its library. `npm run dev` in `frontend/app` supports UI development; that localhost library is separate from the extension library.

## Audio contract

Original WAV files are preserved byte for byte, including channel count and sample rate. Compressed imports decode at 44.1 kHz through Web Audio; their original files are also retained for export. Capture stores finite Float32 samples, including values outside ±1. Mono is duplicated into stereo only for processing. A working copy is resampled for Demucs when needed. Outputs are aligned to the original frame count and sample rate and stored as Float32 WAV without MP3 encoding, clipping or integer quantization. Model inference and sample-rate conversion change samples and are not described as lossless. Four minutes of stereo 44.1kHz Float32 original plus four stems occupies about 424 MB.

Model weights are pinned by revision, byte length and SHA-256, downloaded as data, then cached locally. Executable JS and WASM are bundled with the extension. The single inference worker is cancellable. Keep the library tab open while processing; reopening allows interrupted inputs to be retried. Files survive reloads in the same Chrome profile; uninstalling the extension removes them. WAV export is available for each stem and original; mixer-action recordings export JSON.

## Layout

- `extension/src/content` and `extension/src/page`: Spotify controls and Float32 capture.
- `frontend/app/src/extension`: sender-validated background transfer and capture assembly.
- `frontend/app/src/features/local`: transactional library, audio codecs and browser inference.
- `frontend/app/src/features/stems/player`: existing player, effects, chord analysis and visualizers.
- `site`: static installation guide served at ktv420.web.app.
- `scripts`: bundled runtime preparation and extension ZIP packaging.

Tests cover exact Float32 round trips, malformed audio, resampling, overlap seams, capture ordering/ownership and atomic storage. `benchmark.html` is a development-only browser harness. Model parity and device measurements are documented under `docs/` when verified. The model is Meta HTDemucs; export/FFT attribution and licenses accompany the inference implementation.

CI builds the extension ZIP and publishes it beside the installation guide. It does not deploy any audio service.

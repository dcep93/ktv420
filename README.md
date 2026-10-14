# ktv420

A small desktop Chrome extension captures Spotify as it plays and stores audio locally. The hosted ktv420 player separates four stems on your machine and lets you listen and DJ inside Spotify.

[Architecture and update boundaries](docs/architecture.md)

[Install ktv420](https://ktv420.web.app). No server or container is required. Audio stays in the extension's local library. The player, visualizers, inference runtime and model weights are downloaded; audio is never uploaded. GPU inference uses WebGPU with a CPU/WASM compatibility option.

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

The build stages `dist/extension-candidate` and the hosted app in `site/player`. It leaves your working `extension/build` untouched. **Deploy the website before installing the candidate**: it depends on `https://ktv420.web.app/player/`. After publication, run `node scripts/build-extension.mjs --install` to update the existing `extension` folder, then use its Reload button at `chrome://extensions`. Keep the same installed folder and profile; loading a different folder can create a separate extension identity and empty storage. Reload Spotify after installing. Open a playlist or album and click ktv420 (or the extension toolbar icon) to open its in-Spotify overlay. Click the central **k** capture icon: capture follows the existing playlist/album flow and separation starts automatically as each song finishes. Keep the same path and installation to preserve its library. The extension ZIP contains the storage broker and capture code, with no React player or inference runtime. `site/player` contains the player and local processing code; `dist/ktv420-extension.zip` is the downloadable extension package. `npm run dev` in `frontend/app` supports UI development; localhost storage is separate from extension storage. `http://localhost:5174/spotify-preview.html` is a development-only fixture with a broker on localhost and hosted player on 127.0.0.1 for cross-origin handoff and automatic separation; it does not test Spotify's actual audio hooks.

## Audio contract

Original WAV files are preserved byte for byte, including channel count and sample rate. Compressed imports decode at 44.1 kHz through Web Audio; their original files are also retained for export. Capture stores finite Float32 samples, including values outside ±1. Mono is duplicated into stereo only for processing. A working copy is resampled for Demucs when needed. Outputs are aligned to the original frame count and sample rate and stored as Float32 WAV without MP3 encoding, clipping or integer quantization. Model inference and sample-rate conversion change samples and are not described as lossless. Four minutes of stereo 44.1kHz Float32 original plus four stems occupies about 424 MB.

Model weights are pinned by revision, byte length and SHA-256, downloaded as data, then cached locally. Player JS and WASM are served as static website files and execute in the browser. The hosted iframe has no extension APIs; a versioned, origin-checked broker exposes only local audio operations. The existing extension database is retained; the model cache belongs to the website and may need a fresh download after this transition. The single inference worker is cancellable. Keep Spotify open while processing. **Close** hides the overlay without destroying its worker. The gear menu contains processing and storage controls. **Pause separation** preserves captures in the queue; **Resume separation** continues it. Reopening the overlay resumes interrupted separation automatically; failed tracks have an explicit retry. Files survive reloads in the same Chrome profile; uninstalling the extension removes them. WAV export is available for each stem and original; mixer-action recordings export JSON.

## Layout

- `extension/src/content` and `extension/src/page`: Spotify controls and Float32 capture.
- `frontend/app/src/extension`: sender-validated capture assembly, storage broker and processing locks.
- `frontend/app/src/features/local`: transactional library, audio codecs and browser inference.
- `frontend/app/src/features/stems/player`: existing player, effects, chord analysis and visualizers.
- `site`: static installation guide and generated `/player/` app served at ktv420.web.app.
- `scripts`: bundled runtime preparation and extension ZIP packaging.

Tests cover exact Float32 round trips, malformed audio, resampling, overlap seams, capture ordering/ownership and atomic storage. `benchmark.html` is a development-only browser harness. Model parity and device measurements are documented under `docs/` when verified. The model is Meta HTDemucs; export/FFT attribution and licenses accompany the inference implementation.

CI builds the extension ZIP and publishes it beside the installation guide. It does not deploy any audio service.

The installed Spotify capture → local separation → playback flow was confirmed working by the user on October 13, 2026. The legacy cloud audio service and storage have been deleted. Firebase Hosting serves the installation guide, extension download and player code; audio capture, separation, storage and playback run locally.

Player updates arrive on a fresh load without updating the extension. Current sessions keep their loaded code; no forced refresh during listening. Capture, permissions or incompatible bridge changes require an extension release. Protocol v1 exposes a fixed set of local operations, not arbitrary code or Chrome APIs. Website availability is needed to open the player; saved audio remains local if the website is unavailable.

CI retains previously published immutable player assets using a bounded, integrity-checked manifest. Runtime URLs include their package version. This keeps older open sessions able to load their worker/runtime after later website deployments; only executable assets are retained, never audio. A failed retention check stops publication. Browser-derived model and chord-analysis caches now belong to the hosted origin; cached chord analysis may be regenerated.

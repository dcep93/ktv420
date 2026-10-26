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

The build stages `dist/extension-candidate` and the hosted app in `site/player`. It leaves your working `extension/build` untouched. **Deploy the website before installing the candidate**: it depends on `https://ktv420.web.app/player/`. After publication, run `node scripts/build-extension.mjs --install` to update the existing `extension` folder, then use its Reload button at `chrome://extensions`. Keep the same installed folder and profile; loading a different folder can create a separate extension identity and empty storage. Reload Spotify after installing. Open a playlist or album and click ktv420 (or the extension toolbar icon) to open its in-Spotify overlay. Click the central **k** capture icon: capture follows the existing playlist/album flow and separation starts automatically as each song finishes. Keep the same path and installation to preserve its library. The extension ZIP contains the storage broker and capture code, with no React player or inference runtime. `site/player` contains the player and local processing code; `dist/ktv420-extension.zip` is the package for Chrome Web Store uploads. Users install from the Store; unpacked loading is for development. `npm run dev` in `frontend/app` supports UI development; localhost storage is separate from extension storage. `http://localhost:5174/spotify-preview.html` is a development-only fixture with a broker on localhost and hosted player on 127.0.0.1 for cross-origin handoff and automatic separation; it does not test Spotify's actual audio hooks.

## Audio contract

Capture and Demucs processing retain finite Float32 samples, including values outside ±1; the raw capture limit is **1 GiB per track**. Imported WAVs retain their original bytes until processing completes, and compressed imports decode through Web Audio. After separation, a dedicated local worker encodes the original and all four stems as **320 kbps stereo MP3**. All five use the same sample rate, length and gapless Info/LAME metadata: 32, 44.1 and 48 kHz remain native; other rates convert together to 44.1 kHz. A shared headroom gain prevents overrange input clipping and the player restores that gain after decoding. MP3 storage is lossy. Four minutes across five files takes about **48 MB** (plus small headers), compared with about 424 MB of stereo 44.1 kHz Float32 audio.

The extension uses Chrome's standard IndexedDB quota without the `storage` or `unlimitedStorage` permissions. Available capacity depends on the browser and device; storage can be evicted under pressure. The 1 GiB per-track raw capture limit is unchanged. Replay handoff and playback ownership also use IndexedDB, in a separate metadata database. Updating to 6.3.2 preserves saved audio; reopen a pending replay link if it was handed off before the update.

The extension validates all five files before replacing temporary originals and marking the track ready in one transaction. Encoding, cancellation or storage failure leaves raw audio available for retry. Existing ready tracks are left as they are; there is no migration.

Model weights are pinned by revision, byte length and SHA-256, downloaded as data, then cached locally. Player JS and WASM are served as static website files and execute in the browser. The hosted iframe has no extension APIs; a versioned, origin-checked broker exposes only local audio operations. The existing extension database is retained; the model cache belongs to the website and may need a fresh download after this transition. Inference and MP3 encoding workers are cancellable. Keep Spotify open while processing. **Close** hides the overlay without destroying its worker. The gear menu contains processing and storage controls. **Pause separation** preserves captures in the queue; **Resume separation** continues it. Reopening the overlay resumes interrupted separation automatically; failed tracks have an explicit retry. Files survive reloads in the same Chrome profile; uninstalling the extension removes them. Stored audio exports in its saved format (MP3 for newly completed tracks); mixer-action recordings export JSON.

## Layout

- `extension/src/content` and `extension/src/page`: Spotify controls and Float32 capture.
- `frontend/app/src/extension`: sender-validated capture assembly, storage broker and processing locks.
- `frontend/app/src/features/local`: transactional library, audio codecs and browser inference.
- `frontend/app/src/features/stems/player`: existing player, effects, chord analysis and visualizers.
- `site`: static installation guide and generated `/player/` app served at ktv420.web.app.
- `scripts`: bundled runtime preparation and extension ZIP packaging.

Tests cover exact Float32 round trips, malformed audio, resampling, overlap seams, capture ordering/ownership and atomic storage. `benchmark.html` is a development-only browser harness. Model parity and device measurements are documented under `docs/` when verified. The model is Meta HTDemucs; export/FFT attribution and licenses accompany the inference implementation.

CI keeps the extension ZIP as a GitHub Actions artifact for Chrome Web Store uploads. The website links to the Store and does not host extension ZIPs. CI does not deploy any audio service.

The installed Spotify capture → local separation → playback flow was confirmed working by the user on October 13, 2026. The legacy cloud audio service and storage have been deleted. Firebase Hosting serves the installation guide and player code; audio capture, separation, storage and playback run locally.

Player updates arrive on a fresh load without updating the extension. Current sessions keep their loaded code; no forced refresh during listening. Capture, permissions or incompatible bridge changes require an extension release. Protocol v1 exposes a fixed set of local operations, not arbitrary code or Chrome APIs. Website availability is needed to open the player; saved audio remains local if the website is unavailable.

CI retains previously published immutable player assets using a bounded, integrity-checked manifest. Runtime URLs include their package version. This keeps older open sessions able to load their worker/runtime after later website deployments; only executable assets are retained, never audio. A failed retention check stops publication. Browser-derived model and chord-analysis caches now belong to the hosted origin; cached chord analysis may be regenerated.

Changing songs retains the current visualizer, spotlight, stem faders, mute/solo, effects, tempo and pitch for the session. Stem settings follow their names, not panel order. Shared replays use their recorded settings.

Effects use a shared stereo AudioWorklet for live playback and MP3 export. Choose DJ Filter, Tone, Wah, Telephone, Echo, Reverb, Chorus, Flanger, Phaser, Saturation, Envelope Filter or Vowels. Amount and bypass are smoothed; changing amount preserves delay/reverb history. Click the value to reset to clean, or the power button to bypass without losing the setting. Echo has a manual song BPM and beat interval and follows the player's tempo. There is no pan or auto-pan. Bypass and Echo timing carry between songs and are saved in recordings. Older effect IDs still load, but use the improved sound rather than reproducing the old processor exactly.

DJ playback has separate Tempo (0.5–1.5×, preserving pitch) and Pitch (−12–+12 semitones) sliders. Click their values to reset. New JSON recordings include both controls and replay them; older v2 recordings use normal tempo and pitch. Capture always uses 1×. The custom player owns its playback clock, tempo, pitch and replay. With extension 6.3.17 or later, Spotify DOM commands are best-effort: rejected seeks or disconnected/stale state do not stop or silence local playback. Fresh remote play/pause and seek changes still control the player. Spotify stays muted at 1×; its timeline may drift and is not periodically corrected. The audio processor is served locally with the hosted player; no extra download, cloud processing or permission is needed beyond the normal player update.

Saved and imported performances have an **Export MP3** button. It renders the recorded mix locally as one 320 kbps stereo, 44.1 kHz MP3, including faders, mute/solo, effects, tempo, pitch, pauses and seeks. Every required song must already be captured and separated. Export has progress, an approximate remaining time and Cancel; it neither plays Spotify nor repeats separation. JSON remains available for editable replay. The monitoring-volume slider does not change the exported mix; an overrange mix is attenuated uniformly before encoding. This adds one lossy MP3 generation to the stored stems.

Export holds the existing processing lock and processes one song section at a time. Temporary Float32 audio uses about 21.2 MB per minute on the website's local storage and is removed on completion or cancellation. Available disk quota is checked first, and sections estimated to need more than 1.5 GiB of decoded/rendered buffers are rejected with a shorter-recording message. Long sets made of ordinary song sections are supported within available space. The development-only `export-preview.html` fixture checks audio correctness, cancellation and export speed; it is excluded from publication. No extension update or new permission is required for MP3 replay export.

**Highway** is one shared neon desert drive: drums light roadside markers, bass shapes the road glow, vocals animate the sun, and other fills mountains and passing cacti. It follows the audible mix and preserves its existing replay identifier.

Visualizer choices now include **Stem Weather** (one combined scene with the stem controls beneath it), **Spectrogram** (recent frequency history per stem), and **Stereo Bloom** (actual post-effect left/right differences). Weather follows mute/solo and faders; the original recording has a separate ambient glow. New choices record and replay through the existing JSON format. All prior visualizers remain available.

Canvas rendering uses the existing theme, one transport timestamp, reusable analyser buffers, and capped Retina backing resolution (up to 2×, approximately 1.5 million pixels per canvas). Hidden/offscreen panels skip painting; paused panels settle and then stop redundant work. Spectrogram history freezes on pause and resets on seeks or returning from a hidden view. Stereo analysis uses silent side taps without changing the audible output. `visual-preview.html` is a development-only synthetic preview; **Check visualizers** in `dom-playback-preview.html` exercises the real player, transport and replay.

Combined scenes (Stem Weather, Night City, Stem Garden, Orbit and Highway) expand to an in-page 100vh panel on click, Enter or Space; repeat to shrink. Highway changes its coordinated palette gradually over minute-long transitions. Both ribbon views share stable waveform geometry and smoothed spectral color. See [the visualizer audit](docs/visualizer-audit-2026-10-26.md) for catalog recommendations and remaining polish priorities.

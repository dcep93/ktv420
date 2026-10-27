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

## Links and saved collections

With extension 6.4.0 and the matching hosted player, add `?ktv420` to a Spotify playlist/album URL to open the overlay. `?ktv420=1` opens the first song; indices are one-based and follow the page’s track order, including repeats. Opening a song by link or playlist click is paused. Next/previous and automatic track endings continue playback. Closing removes the parameter; browser Back/Forward restores the view. Unprepared songs stay on the capture page until ready, without starting capture from the link. From extension 6.4.1, Spotify remains visible while a requested overlay loads; the overlay opens only after the current collection has tracks and the hosted player confirms they are rendered. Escape cancels a pending opening.

[Catalog](https://ktv420.web.app/catalog) lists playlists/albums as Spotify links as soon as capture starts, including attempts with no saved songs yet. Each row shows captured songs out of the known total and the number ready for playback; an open catalog refreshes every 2.5 seconds. Membership and titles live in extension IndexedDB; the website reads only collection metadata through a dedicated top-level `/catalog` message. No new permission or cloud storage is used. Existing audio is registered when its playlist/album is revisited, but ordinary visits without audio do not add entries. Started collections remain available for retry even if capture is interrupted or their audio is deleted. Registry membership accumulates known songs from partially loaded Spotify lists. Old `/saved` links redirect to `/catalog`. The settings “Local audio” heading opens the catalog. Each collection has a confirmed delete-audio action: originals and stems (including shared songs) are removed, other songs and catalog links remain. Close Spotify overlays and stop separation before deleting; deletion reserves playback ownership and takes the separation lock. Only the top-level `/catalog` page can request deletion, and only for registered collection paths.

## Playlist transfer

With extension 6.7.0+, use **Catalog → Export → Save ZIP** for a fully prepared playlist or album. The archive contains the original MP3, four stem MP3s, track order, timing/gain metadata, checksums, and artwork when available. Audio is copied without recompression. Upload the ZIP to Dropbox yourself; your friend downloads it and chooses **Catalog → Import playlist → Import ZIP** (or **Import folder** after extracting it). The imported collection opens at its normal `/playlist?id=album.ID` or `/playlist?id=playlist.ID` link without capture or model downloads.

Keep the transfer tab open. Export streams directly to a desktop Chrome save picker; import reads and commits one song at a time. Interrupted imports can be retried with the same package and skip complete songs. Close active Spotify overlays and pause separation before importing. Both sender and recipient need the updated extension; unpacked and Store IDs are independent of the portable package.

Verification: 353 automated tests passed, along with lint and both builds. An isolated browser fixture imported ZIP/folder packages and played imported stems. A separate synthetic 3 GB archive round trip verified every hash at approximately 450 MiB peak Node process memory; a ZIP64 stream crossed 4 GiB. These size tests exercise archive streaming, not 3 GB of browser IndexedDB storage. Reproduce them from `frontend/app` with `npx tsx scripts/transfer-large-check.ts /absolute/output/path.zip`.

## Audio contract

Capture starts strictly at zero: pause Spotify through its DOM controls, prepare the audio graph, seek, verify the actual paused media clock, arm PCM capture, then resume. Timestamped audio blocks preserve pause/resume boundaries even when main-thread delivery is delayed. Finalization drains queued blocks and trims only exact digital silence after the known media duration; tails longer than 50 ms require an observed end event. Missing or repeated blocks, non-silent extra audio, unverified starts and invalid captures are rejected with a specific reason. New captures include timing-verification metadata. Older captures cannot be certified retroactively; recapture them for verified boundaries. `capture-precision-preview.html` is a development-only real-browser signal check (leading silence, non-block-aligned duration, pause/resume, main-thread delay and delayed end events); it does not test Spotify itself.

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

Track completion follows the audio clock, so automatic next-track playback also works without foreground animation frames. Pause, seek, tempo changes and disposal cancel obsolete completion events. A silent development fixture at `/background-playback-preview.html` disables animation frames entirely; add `?stretch` to check half-tempo playback with pitch shifting.

Changing songs retains the current visualizer, spotlight, stem faders, mute/solo, effects, tempo and pitch for the session. Stem settings follow their names, not panel order. Shared replays use their recorded settings.

Effects use a shared stereo AudioWorklet for live playback and MP3 export. Choose DJ Filter, Tone, Wah, Telephone, Echo, Reverb, Chorus, Flanger, Phaser, Saturation, Envelope Filter or Vowels. Amount and bypass are smoothed; changing amount preserves delay/reverb history. Click the value to reset to clean, or the power button to bypass without losing the setting. Echo has a manual song BPM and beat interval and follows the player's tempo. There is no pan or auto-pan. Bypass and Echo timing carry between songs and are saved in recordings. Older effect IDs still load, but use the improved sound rather than reproducing the old processor exactly.

DJ playback has separate Tempo (0.5–1.5×, preserving pitch) and Pitch (−12–+12 semitones) sliders. Click their values to reset. New JSON recordings include both controls and replay them; older v2 recordings use normal tempo and pitch. Capture always uses 1×. The custom player owns its playback clock, tempo, pitch and replay. With extension 6.3.17 or later, Spotify DOM commands are best-effort: rejected seeks or disconnected/stale state do not stop or silence local playback. Fresh remote play/pause and seek changes still control the player. Spotify stays muted at 1×; its timeline may drift and is not periodically corrected. The audio processor is served locally with the hosted player; no extra download, cloud processing or permission is needed beyond the normal player update.

Saved and imported performances have an **Export MP3** button. It renders the recorded mix locally as one 320 kbps stereo, 44.1 kHz MP3, including faders, mute/solo, effects, tempo, pitch, pauses and seeks. Every required song must already be captured and separated. Export has progress, an approximate remaining time and Cancel; it neither plays Spotify nor repeats separation. JSON remains available for editable replay. The monitoring-volume slider does not change the exported mix; an overrange mix is attenuated uniformly before encoding. This adds one lossy MP3 generation to the stored stems.

Export holds the existing processing lock and processes one song section at a time. Temporary Float32 audio uses about 21.2 MB per minute on the website's local storage and is removed on completion or cancellation. Available disk quota is checked first, and sections estimated to need more than 1.5 GiB of decoded/rendered buffers are rejected with a shorter-recording message. Long sets made of ordinary song sections are supported within available space. The development-only `export-preview.html` fixture checks audio correctness, cancellation and export speed; it is excluded from publication. No extension update or new permission is required for MP3 replay export.

**Highway** is one shared neon desert drive: drums light roadside markers, bass shapes the road glow, vocals animate the sun, and other slowly moves the sky between night and day, with faster rhythmic activity adding stars or clouds. Mountains and passing cacti follow an independent sixty-second desert cycle. It follows the audible mix and preserves its existing replay identifier.

Visualizer choices now include **Stem Weather** (one combined scene with the stem controls beneath it), **Spectrogram** (recent frequency history per stem), and **Stereo Bloom** (actual post-effect left/right differences). Weather follows mute/solo and faders; the original recording has a separate ambient glow. New choices record and replay through the existing JSON format. Retired visualizer IDs remain supported in old replays.

Canvas rendering uses the existing theme, one transport timestamp, reusable analyser buffers, and capped Retina backing resolution (up to 2×, approximately 1.5 million pixels per canvas). Hidden/offscreen panels skip painting; paused panels settle and then stop redundant work. Spectrogram history freezes on pause and resets on seeks or returning from a hidden view. Stereo analysis uses silent side taps without changing the audible output. `visual-preview.html` is a development-only synthetic preview; **Check visualizers** in `dom-playback-preview.html` exercises the real player, transport and replay.

Combined scenes (Stem Weather, Night City, Stem Garden, Orbit, Highway, Signal Loom, Ink Tank, Resonance Plate and Glassworks) expand to an in-page 100vh panel on click, Enter or Space; repeat to shrink. Highway changes its coordinated palette gradually over minute-long transitions. Both ribbon views share stable waveform geometry and smoothed spectral color. Super Time Ribbon adds layered prismatic trails, mirrored depth, peak sparks and rings, and an energy-reactive playhead. See [the visualizer audit](docs/visualizer-audit-2026-10-26.md) for catalog recommendations and remaining polish priorities.

Signal Loom weaves a short history of the mix; Ink Tank swirls translucent stem pigments; Resonance Plate draws frequency-reactive sand; Glassworks illuminates a stained-glass mosaic. All four follow stem mute/solo/faders and freeze when paused. Delay Pedal has left the visualizer picker; Hollow Echoes stays. The Echo audio effect is unchanged.

### Hosted playback policy (extension 6.5)

Tempo drift correction runs in the website using the audible player's position. Spotify remains muted at 1×; occasional best-effort seeks keep it from ending ahead of a slowed remix. Corrections are bounded and back off on failure. Their own position echoes are ignored without suppressing remote pause or track changes. The existing 6.4 relay can execute these seeks, so the drift fix does not require the new extension.

With the 6.5 hosted-controller handshake, the website also chooses capture order and automatic capture requests. The extension executes one verified song capture, validates/persists audio, reports native playback, and enforces output/ownership/heartbeat safety. Its legacy controller remains only for older hosted clients during rollout. Capture RPCs are authenticated and cancellable; a request completes successfully only when its audio exists locally. New controller behavior can generally ship through the website, while DOM adapters, precise capture mechanics and privileged storage still require extension releases.

# ktv420: local Chrome extension

Approved direction: desktop Chrome, mostly Apple Silicon Macs. The extension owns capture, a local library, four-stem separation, playback and export. No native service, Docker, port selection, cloud audio storage or remote processing. The public website explains installation. Listening and DJing remain the product focus; no practice loop, common presets or new harmony interface.

## Audio correctness

Capture interleaved IEEE Float32 samples without clamping or integer conversion. Store original samples exactly in Float32 WAV; retain original sample rate. Demucs requires stereo 44,100 Hz: explicitly resample a working copy when necessary, preserve the original, and disclose that sample-rate conversion and neural separation are not lossless operations. Store model outputs as Float32 WAV with equal sample counts and aligned start times. Never encode intermediate or output MP3. No model-weight quantization without numerical evaluation. Native file imports are decoded locally; compressed source quality cannot be recovered.

## Execution and storage

An extension page hosts the library/player and a dedicated inference worker. The worker bundles executable dependencies, downloads pinned, integrity-checked model weights as data once, caches them locally and reports preparation, progress, backend and failures. WebGPU is preferred with an explicit CPU/WASM fallback. No silent substitution of a weaker separation model. Processing is serialized and cancellation terminates the worker. Closing the library interrupts processing; original inputs and completed tracks remain recoverable and incomplete work can be retried.

IndexedDB transactions atomically store metadata and binary Float32 WAV blobs. The extension requests unlimitedStorage. Capture originates in Spotify's page audio graph; a narrow content/background bridge writes to extension-owned storage. Requests are validated against the sender and size/shape constraints. No audio leaves the computer. Website audio storage, Firebase analytics and cloud CRUD are removed. Local deletion and model-cache deletion are visible controls; users can export Float32 WAV files.

## User experience

Updated October 13 after explicit user correction: preserve the legacy Spotify workflow and the in-Spotify overlay. The toolbar focuses Spotify and opens the extension-owned overlay. Preserve the original fullscreen design from commit `3663f23`: the centered close/capture/settings icon row, original colors and typography, and compact artwork/status/name/artist rows. No hero header, marketing copy, instructional banners or library cards. Processing/storage controls belong behind the gear icon. Show the current playlist/album, capture tracks as they play using the existing capture orchestrator, and automatically separate each completed capture locally. No file-import or manual library/separation step is required. The player, effects and visualizers remain inside the overlay. Stored audio is an implementation detail behind the Spotify workflow.

Keep the iframe mounted when hidden so capture and separation continue. Origin/source-check the parent/iframe bridge and expose the extension HTML only to Spotify. Serialize workers across views with a browser lock; pick up new captures, recover interrupted processing and leave failures for explicit retry. Pause/resume separation is shared across extension views and does not discard captures. Keep optional current chord analysis without redesigning it.

## Release and retirement

Current distribution: users install through the Chrome Web Store linked from ktv420.web.app. CI validates and builds the Store upload ZIP as a GitHub Actions artifact, and deploys only the installation website and hosted player. Unpacked loading is for development. Keep Spotify open during separation. Remove obsolete backend code and old naming from the repository. Keep existing cloud resources until the replacement is proven in the installed extension with real Spotify capture, local separation and playback; only then delete dedicated legacy cloud resources; do not create archives. Preserve unrelated resources and the hosting project. Credentials/ownership that cannot be verified are reported as blockers, never assumed.

## Acceptance

Float32 round trips preserve bits (including signed zero and values above unity), reject malformed WAV and nonfinite model inputs, and preserve channel/sample counts. Chunk-boundary tests check overlap and tail handling. Run an actual browser inference fixture and compare against a trustworthy reference where feasible; record backend, model, sample duration, runtime and accuracy limits. Check built extension CSP/runtime paths, actual storage/reload/export, capture bridge and player. Build and lint pass; automated tests cover meaningful failure paths. Do not claim an extension or cloud deployment was verified solely from a successful build.

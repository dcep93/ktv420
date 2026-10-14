# Hosted player with a narrow local extension

Approved with `yesi`: move the existing player, visualizers, effects and local Demucs worker to https://ktv420.web.app/player/. Preserve the existing compact Spotify overlay without redesign. Capture, durable audio storage and a narrowly scoped broker stay in the installed extension. No audio backend, uploads, native service or Docker. No push or deployment during this work.

## Boundary

Spotify embeds an extension-owned broker frame, which embeds the hosted app. The broker is packaged code with extension storage access; the hosted app has no extension APIs or Spotify DOM access. Both links check exact origin, source window and protocol version. A ready handshake precedes state delivery. Capture/close commands remain the existing explicit commands. Library RPC exposes only listing, reading original/playback records, setting processing status, committing four stems, deletion, processing preference, and acquiring/releasing a separation lock. It cannot evaluate code, fetch arbitrary URLs, or invoke arbitrary Chrome APIs. Blob payloads cross local structured-clone messages, never a server.

Keep the IndexedDB name/schema and extension installation path unchanged. Existing captures and stems remain readable without migration. Retain atomic commits, Float32 audio and original files. Coordinate processing across frames using an extension-origin lock. Reject incompatible bridge versions with a useful error. Queue state is persisted; interrupted inference can resume. Restrict mutation sizes/shapes and commands. The broker owns pause preference so it remains shared across hosted views. Model cache moves to the hosted origin and can require a fresh model download; audio does not move.

## Delivery

Separate Vite outputs: website player includes React, worker, JS/WASM and visualizers; extension build contains only broker and background/storage code. Production broker fixes the player URL; development fixtures use a separately gated local URL. Static hosting root stays the installation guide, /player/ serves the app. HTML is revalidated; hashed assets are immutable. Do not live-replace an active player. Website deployments update fresh sessions while existing sessions retain their loaded version. One extension release is necessary for this transition; future capture/permission/protocol changes still require extension review. Use a compatibility version for bridge updates.

Website CSP permits only its own executable code, pinned model download origins and album images. No audio upload endpoints, analytics or arbitrary message forwarding. Configure framing and WASM correctly without requiring cross-origin isolation, since the supported CPU fallback is single-threaded.

## Verification and release limits

Test wrong origins/windows/versions, forbidden RPCs, lock contention/release, Blob fidelity, invalid/partial stem commits and preservation of existing data. Build/lint/tests must pass. Exercise a development broker and hosted iframe across distinct origins through browser UI, including automatic separation and playback where possible. Inspect the extension ZIP to ensure inference/player assets are absent, and the hosted build to ensure they are present. Installed extension and production-host checks cannot be claimed without deployment; keep the current installed working build intact until publication is authorized. Do not overwrite it with a broker that points to an unpublished website. Stage the candidate extension separately for review/testing.

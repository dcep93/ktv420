# Standalone ktv420 (approved external plan)

The website is the music app and sole canonical library. Reuse the current playlist ZIP/folder transfer, mixer, visualizers, replay, encoding and WebGPU workers. Fresh database; no migration, old protocol support or legacy package support. Do not delete previous extension databases.

The extension provides Spotify discovery, precise single-song capture and a durable temporary delivery queue. It has small native capture controls, no player or hosted iframe. The website issues one explicit capture at a time and schedules subsequent songs. Website closure stops scheduling but does not discard an in-flight completed recording. Sequential bounded chunk reads are retryable and acknowledged only after a website transaction commits input and collection metadata. Request IDs and track IDs make delivery idempotent.

Only the exact production website origin and top-level frames may invoke versioned allowlisted extension operations. Validate tab ownership, collection context, capture identifiers, indexes and sizes. No arbitrary script or Chrome API relay. Playback has no Spotify dependency.

Use website Web Locks for processing/import/deletion coordination, atomic IndexedDB commits, storage estimates and persistent-storage requests. Recover interrupted processing from raw input on reopening. Preserve model/worker paths and explicit WASM choice. Validate with new-architecture storage/transfer/protocol tests, existing capture integrity tests, lint, both builds and available browser checks. Document real versus simulated verification and unavailable GPU comparisons.

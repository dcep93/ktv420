# Reliable catalog registration

The user has saved audio for an album absent from /catalog. The catalog currently reads only collection records. Content-script registration ignores failed responses; capture contexts survive separately and can provide evidence for recovery. The exact failed request in the user's browser is unknown.

## Approved behavior

Register a collection when capture starts, and reconcile it when the overlay loads or captures finish. Await registration before starting capture so its metadata reaches the worker first. Retry transient failures with bounded delays and a timeout; show persistent failures in the existing error area without stopping otherwise valid audio capture. Keep catalog errors separate from capture errors. Ignore stale registration work after Spotify navigates to another collection.

On catalog reads, recover missing collection records from validated stored capture contexts whose track IDs match existing local audio. Mere visits without audio must not populate the catalog. Preserve saved timestamps, metadata, deduplication, and current captured/ready counts. Reopening an album must repair its entry using existing audio, without recapturing. Never infer memberships from song titles or artists.

## Scope and safety

Use the existing extension state database and message protocol. Keep origin/path validation, permissions, hosted app interfaces, and audio blobs unchanged. No browser database migrations or data deletions. Release a patch extension version; the user reloads the extension and Spotify once to activate it.

## Verification

Tests cover retries, dropped replies, stale routes, surfaced errors and recovery, capture registration ordering, absent registry recovery, no visit-only entries, persistence after context eviction, idempotence, and existing security validation. Run the full test suite, lint, and both production builds. Install the compatible extension build, commit and push, verify deployment. Live browser recovery requires the user's extension reload; distinguish tested recovery logic from unverified recovery of their specific album.

## Live verification follow-up: late artwork

After the user's 6.5.3 reload, the Olivia Rodrigo album appeared with 13 captured and 13 ready tracks. DOM inspection confirmed the catalog row had no image while Spotify's header had a valid scdn cover. A regression reproduced the remaining defect: UI refresh checked only for a missing title, so an independently delayed cover never updated the catalog. Continue polling incomplete title/artwork independently, use currentSrc or src, accept the same scdn origins as registry validation, retain known fields, and register only changed metadata. Keep the active capture context current too. No audio writes or membership changes are needed.

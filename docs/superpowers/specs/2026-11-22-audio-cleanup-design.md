# Release previous-song audio

The user approved a local cleanup fix and rollout preparation after investigation. The live heap contained 32 disposed tempo engines and 192 old worklet nodes. Their error-handler closures retained decoded audio; removing those listener edges in an offline graph analysis made 15,766,604,080 audio-data bytes unreachable. This is retention across song changes, not a requirement to change tempo/pitch loading.

## Scope and design

Keep existing playback, effects, tempo/pitch and saved audio behavior. Explicitly detach processor-error and port callbacks when effects and tempo nodes are disposed. Clear the tempo engine's buffer and graph collections, and the player's decoded-buffer references on unmount. Release the playback-end callback too. These operations must be idempotent and must finish reference cleanup even when processor teardown fails.

Put all tempo initialization after node creation inside the failure-cleanup boundary, including channel copies and graph setup. Failed or superseded loads must not leave callbacks or buffers attached to an abandoned engine. Do not add lazy tempo loading, reduce audio quality, delete saved recordings, or force-reload user sessions.

Alternatives considered: lazy tempo allocation reduces current-song overhead but does not remove this retention path; periodic page reloads release memory but interrupt playback. Explicit resource cleanup addresses the observed cause.

## Verification and delivery

Use a browser fixture with the real Player and real worklets: repeatedly mount, play and replace songs at neutral and shifted tempo/pitch, then unmount. Check retired listeners and closed contexts, and verify the heap no longer retains decoded buffers for historical songs. Exercise initialization failure and idempotent disposal. Run existing audio regression fixtures, repository tests, lint and production builds.

Prepare hosted artifacts, immutable-asset retention, a local commit, deployment steps, post-deploy checks and rollback instructions. Keep everything local: pushing main triggers the production workflow. Existing loaded sessions require a deliberate reload after rollout; the package cannot retroactively fix their existing closures.

# Hosted playback and capture policy

Approved by the user: fix tempo drift in the hosted app and slim the extension. Dropbox sharing is deferred.

The audible player is authoritative. A hosted synchronizer compares actual mixer position (plus capture offset) against native Spotify time while stems play. Correct drift exceeding five seconds or a dangerous early ending, one best-effort seek at a time, with timeout/backoff. Never change Spotify rate, capture timing, or the audible mixer to fix drift. Track identity, pause, stale state, capture activity and local ownership gate corrections. Tag self-seeks and suppress only their position echoes; remote pause/skip must remain observable. Existing relay commands support the first deployment; a new optional capability improves self-seek reporting without breaking old installations.

The new extension reports native time and executes validated DOM commands. Remove its independent tempo clock and synthetic next-track policy. Hosted code chooses automatic capture and playlist capture order. Extension retains a bounded single-song precise capture operation, storage validation, output silencing, ownership and heartbeat safeguards. Preserve legacy capture entry points for older hosted clients during rollout. No new permissions.

Capture RPCs have request IDs, a single active request, explicit cancellation, completion/error replies, track allowlisting, and no success on partial captures. Hosted queues skip saved audio, preserve order, stop on errors, and cancel on overlay closure/navigation. No automatic retries of failed capture. Browser frame loss must stop capture even without a final UI command.

Validation: deterministic drift/timeout/remote intent tests, old/new protocol compatibility, hosted queue progression/cancellation, extension precise-capture regression suite, full tests/lint/build. Deploy hosted app and package updated extension; report whether real Spotify testing remains. Do not mutate the user's live captures for testing.

## Verified implementation

Hosted controller capability is negotiated during ready before overlay activation. Legacy installations retain their existing capture path; drift correction uses their existing seek API. The new relay preserves a legacy controller branch for older hosted assets, but negotiated clients receive native time and perform capture scheduling in the website. No new extension permissions.

Full-song simulations cover 2, 8, 30 and 180-second tracks at 0.5, 0.8, 0.95, 1 and 1.5×. Near the end, the native mirror may deliberately lag by up to eight seconds to leave a safe seek/cooldown margin; audible audio is never repositioned. Failed corrections back off rather than blocking playback. A permanently unresponsive Spotify mirror can still auto-advance; DOM-only observations cannot perfectly distinguish that from a deliberate remote Next at the boundary.

The real React hook browser fixture passed sequential capture, cancellation, completion and library-readiness checks. Protocol and extension tests cover authenticated single-song RPC, native time, capture exclusion for seeks, and heartbeat shutdown. Precise capture routines are unchanged. Real Spotify playback and remote-control validation remain a manual release check after reloading the extension.

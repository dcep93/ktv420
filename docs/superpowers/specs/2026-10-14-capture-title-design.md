# Capture progress in the tab title

Show `[42%] ktv420 — <Spotify title>` while capturing. Percentage covers the capture queue: already saved songs count as complete and the active song contributes its recorded fraction. Each song has equal weight because reliable duration metadata is unavailable for the whole queue. Do not show 100% until captures are saved. Separation is not included.

Preserve the latest title set by Spotify and restore it on completion, cancellation, error, or handoff. Protect the prefix when Spotify changes titles. Batch progress comes from the orchestrator; automatic listening uses the visible playlist and local capture catalog, falling back to a single song when no playlist is available. Verify cached songs, progress across song boundaries, persistence, stopping, and title restoration.

# Smooth capture and recoverable overlay

Authorized: make the improvements needed for smooth playlist capture and recover the blank view.

The current handoff saves an entire raw recording while Spotify is paused, then waits for a website poll. Browser instrumentation has previously replaced overlay frames with empty srcdoc documents; there is no recovery or visible fallback. Preserve all existing exact-start, source identity, audio clock and natural-end verification.

Implement incremental staging during playback: bounded 256 KiB chunks, incremental MD5, and a retained tail until natural-end validation. Incomplete staging is never published or processed. Final commit validates the full metadata and exact received bytes atomically. Cancellation/reload cannot promote partial audio. Keep existing nonstreaming delivery compatible.

Notify the hosted scheduler of status changes immediately through the existing source/origin-validated overlay relay; retain polling as recovery. Avoid playback button acknowledgment delays when the actual media state is checked independently. Record bounded successful/failed traces, every startup retry, and handoff milestones without audio or private credentials.

Repair unexpected srcdoc/src changes on owned overlay frames. Provide a packaged loading/retry fallback, a React error boundary, and preserve active queue intent across view recovery. Reattach to an in-flight capture rather than restarting its song. Closing or explicitly stopping clears that intent.

Verify streaming byte identity/tails, unverified and incomplete commit rejection, cancellation, retries, event races, overlay recovery, and full regression/lint/build checks. Publish and update the existing unpacked extension; use native browser controls only for live Spotify verification. Measure actual transition timing separately from synthetic tests. No guaranteed silence duration until observed.

Self-review: one capture at a time, no unbounded concurrent saves, no new permissions, no audio uploads. Streaming staging never asserts end verification early; durable publication remains the final boundary. DOM repair is restricted to frames owned by ktv420. Full Spotify source replacement still requires recapture; diagnostics must explain it.

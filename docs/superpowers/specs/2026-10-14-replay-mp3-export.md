# Replay MP3 export

Approved in conversation: one Export MP3 action alongside JSON on saved/imported recordings, 320 kbps stereo, compact progress/ETA and Cancel. No new preferences, cloud processing, Spotify playback, capture or separation. Existing local stems are required. Deliberate recorded pauses and seeks remain; visualizer/spotlight and listening-monitor volume do not affect the file. Export applies the recorded mix at unity master gain and reduces the entire file uniformly only when necessary for clipping headroom.

## Approach

Render the saved performance timeline using OfflineAudioContext, the existing TempoEngine and the same effect graph/volume curve as live playback. Render one recorded track section at a time and discard decoded audio between sections. Snapshot/effect routing changes apply at audio-quantum boundaries (less than 3 ms at 44.1 kHz); shared smoothing preserves live parameter transitions. Pause and seek keep existing effect tails within the section; changing track discards the previous track graph, matching replay. The output ends at recorded Stop without invented padding.

Spool stereo Float32 output into an origin-private temporary file, measure its peak, then encode it in a worker with one continuous MP3 encoder and a gapless header. This avoids retaining an entire set in RAM and avoids MP3 seams between songs. A cross-tab export lock protects the single scratch directory; clean stale scratch on next export and remove scratch after success/failure/cancel. Check disk quota and per-section memory requirements before allocating; reject oversized sections explicitly instead of risking a browser crash. MP3 encode adds a lossy generation to stored MP3 audio, as explained to the user.

Expose progress weighted between rendering and encoding, with ETA only after meaningful progress. Cancel terminates encoding and disposes audio processing. No partial download. UI uses existing colors and button styles, on both Saved recording and Shared recording cards. Disable export while capture, separation, live recording/replay or deletion is active to avoid competing for memory. Closing the overlay cancels an active export.

## Correctness and validation

Extract only the shared audio graph/gain helpers needed for parity. Validate all recording events, stem names/layout, duration and capture offsets before rendering. Source audio never leaves the computer and remains unchanged. Tests cover event ordering, pauses, seeks, tempo/pitch, normalization, MP3 duration, cancellation and cleanup. A browser fixture compares live-engine/offline waveforms for representative effects and measures a five-minute export with tempo/pitch and automation. Report actual timing, not an unverified estimate. Run unit tests, lint/build, and publish only completed validated changes. Existing extension broker operations suffice: no permission or extension version change is planned.

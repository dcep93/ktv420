# Preloaded Pitch Ribbon

Approved design: calculate a source-time pitch contour from decoded audio in a background worker. Show the same five seconds of history and fifteen seconds of future as Time Ribbon, with now at one quarter width. Pausing and seeking must immediately display available source data, with no accumulated live-history delay.

Use centered analysis windows on a 50 ms source grid, a short centered loudness gate for silence, and symmetric smoothing so note transitions are not shifted later. Preserve perceptual pitch detection, an audio-derived color palette consistent with Time Ribbon, strong quiet-note visibility, and real breaks for rests. No instrument-name heuristics. Pitch shift offsets the contour; tempo only changes how quickly the source clock advances. The contour describes source audio, not live effect output.

A single worker processes bounded chunks for all decoded tracks, prioritizing the visible time range. Keep lightweight results with the current player's decoded buffers, including across visualizer changes. Transfer only chunk copies, never playback buffers. Cancel work when the player/song changes. Analysis failures must not block playback. Render only visible points, with no pitch estimation in animation frames. A deterministic local range keeps melodic steps visible without depending on playback history.

Verify generated low/high melodies, note-onset alignment, silence gaps, stereo phase cancellation, chunk-boundary continuity, seek prioritization, stale-worker cancellation, pitch offsets, paused lookahead, rendering cost, and worker throughput. Run repository tests, lint and both builds, inspect the synthetic browser fixture, commit/push and verify deployment. No extension update.

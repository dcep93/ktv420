# Inherited, responsive volume

Initialize listening volume from Spotify's DOM slider each time the overlay opens, including zero. Preserve the explicitly requested silent replay-preparation flow. Remove the arbitrary 70% controller default.

Continuous volume input must bypass the serialized playback-command queue. Publish the user's latest volume immediately so the existing hosted slider and stem player update without waiting for Spotify. Coalesce Spotify DOM writes into 32ms windows, retaining only the most recent value. Update capture monitoring through the existing silence-handshake policy; volume changes must not unmute idle or stem playback, nor scale captured PCM.

Ignore stale volume observations during a drag and its short settling interval, then continue accepting external Spotify volume changes. Cancel pending volume writes on overlay close. Preserve validated, acknowledged transport volume commands for other callers.

Verify inherited nonzero and zero volume, immediate state publication, burst coalescing, no pause backlog, stale-state resistance, later external updates, idle muting and close cancellation. Run tests, lint and build, install 6.3.7 at the existing extension path and commit locally without pushing. The hosted UI protocol is unchanged, so no website deployment is required.

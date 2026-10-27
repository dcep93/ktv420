# Playlist logo opens the first captured track

Approved behavior: on the playlist view, clicking k or pressing Enter opens the first Spotify row in track view when every listed song already has a local capture. Entry stays paused and updates the existing one-based ktv420 track URL. Captured originals may open while separation continues; ready stems continue to load normally. If any song is missing, keep capture startup. If capture is active, keep Stop. Keep the existing track-view logo action (back to playlist), settings behavior, replay preparation, and busy guards.

Implement this in the hosted web app using the existing paused open-track path, without extension changes. Wait for the local library to load before treating the list as captured; require a nonempty list containing row zero. Keep unfinished playlist rows nonclickable as before; the logo explicitly supports captured originals. Track URL entry should also recognize saved originals so reloading the resulting link works consistently. Preserve the player settings and automatic next-track behavior.

Validate the complete/missing/loading/empty/reordered/partially separated cases, reuse one handler for mouse and keyboard, run tests/lint/build, and publish. No audio mutations, storage migration, or new UI controls.

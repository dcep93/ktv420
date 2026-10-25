# Explicit ktv420 activation

Spotify playback must remain normal until the user opens ktv420. Keep early media discovery and playlist metadata observation, because Spotify creates detached media before activation. Passive observation must not change volume, mute, speed, create audio graphs, capture, prepare the hosted player or claim listening ownership.

The listening controller starts disabled. Opening the overlay explicitly enables page audio routing before controller polling and track loading. Closing or Escape pauses first, stops a batch if needed, waits for in-flight polling, aborts partial auto-capture and releases routing. Existing audio graphs become unity-gain passthroughs with Spotify's requested native volume/mute restored; subsequent volume changes work normally. Reopening enables routing again. A replay handoff opens the overlay explicitly and retains its silent preparation preference.

Guard capture, tempo and monitoring commands in the page script while disabled. Serialize activation transitions and avoid reactivating an already-open overlay. Test passive playback, no controller DOM/storage/output work before activation, restored volume/mute/tempo after release, and reactivation. Run the full suite, lint and build; install 6.3.6 into the existing extension directory and commit locally without pushing.

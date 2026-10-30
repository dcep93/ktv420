# Overlay audit follow-up

User approved fixing the audit findings, restoring Separation settings, and website X navigation.

- Visible capture views observe the background queue silently; connection checks never produce recurring status banners. Stopping capture removes percentage titles. Space cannot activate capture/settings buttons.
- Failed rows directly retry separation. Keep one short status/percentage; technical steps remain in the tooltip.
- Overlay settings have a dedicated Separation card: pause/resume, retry, GPU/CPU, and downloaded-model management. Keep extension audio deletion separate. Preserve logo position.
- Website X pauses playback and returns track/settings-from-track to the playlist, clearing the track URL parameter; the next X returns to catalog. Spotify overlay X still closes the overlay.
- Page entry checks existing background work, not merely document presence. Persist genuine progress timestamps, ignoring elapsed heartbeat text. Recover expired claims or no progress for 90 seconds (180 seconds for CPU), extended to four times the slowest observed operation. Preserve originals, invalidate obsolete writes, and limit automatic restarts to three. Recent/slow legitimate progress must not be restarted. Normal polling does not request recovery.

Validation: targeted state/health regressions, full tests/lint/build, browser checks using controlled overlay states and real saved synthetic audio. Verify silent connection, keyboard, title, retry, settings, X navigation, and background worker recovery. Live Spotify capture remains a separate check requiring the updated extension to be reloaded.

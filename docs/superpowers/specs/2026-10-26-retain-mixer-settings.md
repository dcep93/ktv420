# Retain the current mixer setup across songs

User requirement: changing songs keeps visuals, spotlight, effects and every
other mixer setting. Retain one in-memory setup in LibraryPage; each new Player
initializes from it before decoding audio or autoplay. Match stem choices by
name and input/output identity rather than song-specific ID or panel order.

Carry visualizer, spotlight intent/level, each stem's volume, mute, solo/deafen,
effect type/amount, tempo and pitch. Keep the existing parent master volume.
Start the new song at its own beginning; recreate audio nodes and analysis data.
Missing stems use normal defaults; an unavailable spotlight clears safely.
Replay applies recorded snapshots and does not overwrite the live mixer setup.
This is session continuity, not a new disk preference or preset system.

Implementation: add a pure settings mapper, initialize Player with a fixed
snapshot, and report ready mixer changes to a LibraryPage ref. Validate remapped
stems, missing stems, defaults and snapshot independence; run tests, lint/build,
then deploy the hosted player. No extension update is required.

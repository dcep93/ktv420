# Linked volume locks

Approved in conversation with `yesi` after replacing the remembered-balance proposal.

## Behavior
Replace each track's deafen button with an icon-only lock toggle, off by default. Include Original as well as all stems. A locked track remains directly editable, but other tracks cannot move its slider. For an edited locked slider, calculate its clamped new value minus its current value; subtract that delta from every unlocked track's current slider value and clamp each result to 0–2. An unlocked edit changes only itself. All sliders and audio gains update together. No starting balance, drag anchor, ratio restoration, or automatic loudness normalization. At bounds, discarded movement is not recovered. Double-click volume reset uses the same rule with target 1.

Mute/unmute changes no slider value and no lock. Linking may change a muted track's slider, but never unmutes it. Lock toggling alone changes no volume or mute state. With all tracks locked, editing changes only the edited track. Preserve existing layout, using a small outlined lock/unlock icon and accessible name; add no visible explanatory text.

## State and compatibility
A pure linked-volume function consumes current volumes, locks, active track IDs, edited ID, and target. The player immediately updates current refs before React state/audio writes so fast input cannot use stale values. Snapshots include optional `locked` per stem, default false for old recordings/settings. Capture complete resulting volume snapshots for recording; replay and MP3 export apply those values directly, never run linking again. Carry locks across songs like other mixer settings.

Retain deafen only to play historical recordings. Convert inherited live deafen settings into equivalent mute flags and clear deafen so the removed UI cannot leave an inaccessible solo state. Historical recording playback/export retains its original deafen semantics.

## Verification
Test unlocked and locked edits, multiple protected locks, all locked, both bounds, inverse motion after clipping without hidden restoration, rapid successive updates, Original participation, default/retained lock settings, old solo migration, snapshot validation, replay/export compatibility. Run full tests, lint and production build. Inspect the lock UI in a local fixture without disturbing the user's active Spotify capture. Commit/push main and verify hosting deployment; no extension update is required.

## Review
Scope is confined to volume linking, its UI, mixer settings and recording compatibility. The final approved delta-based behavior supersedes earlier focus/balance and gain-holding proposals.

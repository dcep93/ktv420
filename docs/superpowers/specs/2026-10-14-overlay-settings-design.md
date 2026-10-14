# Overlay settings polish

Preserve the compact track list, cards, theme, and three-button header. Opening settings must keep the header at its current viewport position; the settings panel scrolls beneath it. Returning restores the previous view. Preserve the current centered track view rather than moving every view to a new fixed header position.

Explain separation and model removal in two short helper lines. Pausing separation preserves captures and restarts unfinished work when resumed. Removing the downloaded model frees approximately 181 MB, retains audio, and requires another download for future separation.

Add Delete all audio within the existing Local audio card. Require an inline destructive confirmation; cancel changes nothing. Disable deletion during capture, separation, mix recording, or an existing deletion. Prevent this view from starting separation during deletion; delete saved tracks and their audio using the installed broker's guarded delete operation. Preserve the processing preference without changing persistent settings. Other views' processing locks reject deletion safely. Warn before navigating away during a batch. Clear loaded playback references. Refresh and display errors after partial failure; never claim an unsuccessful deletion completed. Retain model cache and preferences. No user's actual audio is deleted during development.

This is a hosted player update only: no extension permission, protocol, or package change. Verify header coordinates for short and long lists, confirmation/cancellation, deletion of all stored original/stem blobs, preservation of the model, blocked concurrent processing, empty state, and existing automated checks.

Verification: 56 existing tests passed, lint and both builds passed. Isolated Chrome checks preserved header x/y for five-track and forty-track views; cancelling retained five tracks, capture disabled cleanup, a held separation lock rejected deletion without loss, retry removed all 25 audio blobs and five track records, the model cache remained, and removing the model updated its status. No browser errors.

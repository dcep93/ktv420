# Chrome Web Store resubmission — 6.3.2

The rejected upload was 6.0.1 (Purple Potassium: unused `storage` permission). Version 6.3.2 removes `storage` from the manifest. Subsequent replay/playback coordination code had begun using `chrome.storage`; it now uses IndexedDB instead. The package has no Chrome API permissions and no optional permissions.

## Permission audit

- `https://open.spotify.com/*` is the only host permission. It supports the Spotify content scripts, finding an existing Spotify tab from the toolbar button, and communicating with that tab for capture and playback controls. No broad `tabs` permission is requested.
- Content scripts and web-accessible resources are restricted to Spotify.
- External messaging is restricted to `https://ktv420.web.app/*`; the background handler further requires the top-level `/replay` page and validates the recording. It accepts a replay handoff, not requests to read audio.
- Audio remains in the existing extension IndexedDB library. Small replay and playback-ownership records live in a separate IndexedDB database. Neither uses `chrome.storage`.

Chrome documents the permission requirement for [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage) separately from [web storage available in extensions](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

## Upload

Upload `dist/ktv420-extension.zip` as the replacement package. In Privacy practices, remove the obsolete storage-permission justification if it remains. Retain the Spotify host-permission justification:

> Access to open.spotify.com is required to display ktv420's overlay, capture playback locally, read the current playlist/album and playback state, and control Spotify playback and volume through its page controls. The toolbar button locates and opens the overlay in an existing Spotify tab.

Suggested reviewer note:

> Addresses Purple Potassium for version 6.0.1. Version 6.3.2 removes the storage permission and all chrome.storage API calls. Local audio and replay coordination use IndexedDB. We audited the remaining access: only open.spotify.com host access is requested, for the Spotify overlay, local capture and playback controls.

## Verification

- Tests exercise replay validation, persistence before navigation, tab/path isolation and clearing only the owning tab's pending replay, with no `chrome.storage` mock.
- IndexedDB tests exercise concurrent playback claims, persistence across database connections, lease expiration and transaction rollback.
- Manifest regression test restricts API permissions to none and host access to Spotify.
- Run `npm test`, `npm run lint` and `npm run build` in `frontend/app`, then `node scripts/build-extension.mjs` from the repository root.

This addresses the reported permission rejection; Chrome Web Store approval still depends on its review. No submission is performed by the packaging script.

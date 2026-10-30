# Chrome Web Store package — 7.5.1

## Permissions

The package requests `offscreen` for one background document hosting local audio workers. It does not request `storage`, `unlimitedStorage`, `tabs`, or optional permissions. Local files use IndexedDB.

Offscreen justification:

> The offscreen document hosts a local audio separation worker so processing continues when the user closes or refreshes the Spotify overlay or ktv420 website. It reads only audio captured by ktv420, produces local MP3 stems, and retains them until the website durably imports them. The document does not play audio or upload recordings.

Site access remains limited to `open.spotify.com` and `ktv420.web.app`. Content scripts and public extension resources are restricted to Spotify. Website external requests require a top-level ktv420 origin. The offscreen relay accepts only processing operations, validates the iframe origin/source, and exposes no Chrome API to the hosted page.

## Hosted code

Privileged extension logic is packaged. The overlay and processing application run in isolated hosted website iframes and communicate using validated messages. Do not claim that all application code is packaged: the hosted application includes local inference, encoding and UI logic. Model weights are fetched as data and verified against a pinned SHA-256.

## Package and verification

`dist/ktv420-extension.zip` is the upload package. The offscreen permission is exercised by `chrome.offscreen.createDocument` with the `WORKERS` reason. Tests restrict the permission set, reject worker impersonation and view-owned inference claims, and verify durable import, retry and deletion behavior. Nothing is submitted to the Store automatically.

Reference: [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

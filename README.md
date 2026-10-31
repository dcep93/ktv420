# ktv420

[Open ktv420](https://ktv420.web.app) to import a playlist, listen, remix and visualize music locally. The website owns your audio library. **No extension is needed for imported music.**

The optional [Chrome extension](https://chromewebstore.google.com/detail/ktv420/kmkbecinmhkfihahalgclomhcicmoiia) captures Spotify. Click **k** to open the full hosted capture playlist as an iframe overlay over Spotify. Song links open the mixer on ktv420.web.app. A persistent background worker separates recordings while capture continues and writes directly into the same website library used by the overlay and standalone app.

## Getting started

- **Import:** Catalog → Import playlist → ZIP or extracted folder. Open the imported playlist, then a prepared song. Entering a track starts paused; track endings advance normally.
- **Capture:** install extension 7.6.1, reload Spotify, open a playlist/album, click **k** to open the overlay, then click its central **k**. The overlay chooses missing songs; Spotify records one at a time. Separation continues after closing either view and Settings pauses/resumes the same queue. Finished tracks appear directly in the website library, with no import step or second prepared-audio copy. Monitor volume does not change captured samples.
- **Share:** Catalog → Export → Save ZIP. Upload to Dropbox yourself. Your friend downloads and imports the ZIP or extracted folder. No Dropbox integration, extension, model download or separation is needed for imported prepared audio.
- **Replay:** `/replay` accepts a recorded mix JSON. Import the required playlist audio, then open the recording in the website mixer. Export MP3 renders the performance locally.

`/` and `/catalog` show the library. `/playlist?id=album.ID` and `/playlist?id=playlist.ID` open a saved collection. Append `&ktv420=1` for its first track (one-based). Close returns to the catalog on the website; in Spotify, it closes the overlay and pauses playback/capture. Spotify links support `?ktv420` and one-based `?ktv420=1`. No Spotify tab IDs are used in URLs.

## Clean break in version 7

One website-owned library is shared by the top-level site and extension-hosted frames. Version 7.6 recovers existing 7.x extension captures and prepared stems automatically. There is no migration from pre-v7 databases or old isolated overlay libraries, and no support for old extension protocols or version-1 playlist packages. Exported version-2 packages round-trip originals, four stems, metadata, timing, shared gain, artwork and ordered membership, including repeated songs. Audio bytes are copied without recompression.

Old extension databases are neither opened nor automatically deleted. Removing the extension does not affect website audio, but removes temporary recordings not yet committed to the website library. Clearing website data does. Requesting persistent storage may be denied; the app reports this and retains export/deletion controls. Both origins use normal browser quotas, with no `storage` or `unlimitedStorage` permission.

## Responsibilities

The website owns catalog, audio, capture scheduling, separation, encoding, playback, effects, visualizers, recording and import/export. Audio stays on the computer; there is no audio-processing backend, Cloud Run service or GCS audio store. Firebase Hosting serves static app files. Pinned model weights download as data.

The extension owns Spotify discovery, DOM transport, precise Float32 capture, a temporary durable raw buffer, background-document lifetime, and a metadata-only status cache. The hosted background worker reads verified raw chunks, commits an original to the website library, and atomically replaces it with validated MP3s. Only then is the temporary extension recording acknowledged and removed. A crash after commit retries acknowledgment without rerunning inference. Legacy prepared copies are imported once for upgrade recovery. Closing the overlay stops capture; separation continues independently.

Chrome’s host-permission exemption lets the nested website iframe access the same IndexedDB as a standalone website tab. No storage-access prompt is needed. Separation recovers interrupted work from stored raw inputs. Browser Web Locks coordinate separation, import and deletion. The existing Demucs model, WebGPU worker and MP3 worker remain. Supported GPU devices use explicitly requested WebGPU; initialization failure is visible rather than silently switching the entire job to CPU. The settings page provides a CPU/WASM option.

## Audio

Capture verifies the actual Spotify media is paused at zero, arms capture, then starts playback at 1×. Existing sample-clock, source-identity, natural-end and missing-block checks remain. Failures include the current phase and recent media observations in Spotify’s console and `ktv420:last-capture-failure` Session Storage. Logs contain no audio and are never uploaded.

Raw capture is limited to 1 GiB per song. Processing preserves Float32 precision until a local worker encodes the original and four stems as 320 kbps stereo MP3. All files share timing, gapless metadata and a common headroom gain, restored on playback. Four minutes across five MP3s takes about 48 MB. MP3 storage is lossy; ZIP export adds no new compression loss. Large playlist exports stream to disk, and imports commit one song at a time.

The mixer retains independent tempo/pitch, effects, linked faders, mute, spotlight, visualizers, fullscreen scenes, JSON performance recording and MP3 performance export. Settings carry between tracks. Playback and replay do not depend on Spotify transport, browser-extension IDs or an extension connection.

## Development

Node 22+ and desktop Chrome 121+ (current Chrome recommended):

```sh
cd frontend/app
npm ci
npm test
npm run lint
npm run build
cd ../..
node scripts/build-extension.mjs
```

This stages `dist/extension-candidate`, `dist/ktv420-extension.zip` and `site/player`. The root homepage is generated from the same app build. Publish the website before installing the extension candidate. Then run `node scripts/build-extension.mjs --install`, reload the unpacked extension at the existing `extension` folder, and refresh Spotify. GitHub Actions publishes the website and retains the Store ZIP as an artifact.

`npm run dev` serves the website on port 5174. Localhost storage is independent of production. Top-level website pages can receive pending captures from the extension. Spotify controls are available only through the packaged overlay frame, bound to its enclosing Spotify tab. The hosted origin must be exactly `https://ktv420.web.app`; the production relay is intentionally unavailable on localhost. Development harnesses are excluded from the published build:

- `/standalone-preview.html`: real browser ZIP/folder import/export and synthetic player fixtures, without an extension.
- `/benchmark.html`: explicit WebGPU/WASM model verification with cold and warm timings.
- `/capture-precision-preview.html`: real audio block/boundary checks with synthetic signals; it does not impersonate Spotify.
- Existing effect/visualizer preview pages exercise the unchanged mixer.

See [architecture](docs/architecture.md) for databases, protocol and failure handling. Browser verification and outstanding hardware checks are recorded in [verification notes](docs/standalone-library-verification.md). Historical measurements under `docs/` describe their original revisions, not a new performance guarantee.

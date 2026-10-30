# ktv420 architecture — version 7

The website is the music app. The optional extension integrates Spotify. Audio never goes to a ktv420 server.

```mermaid
flowchart LR
  Spotify[Spotify DOM + audio] --> Capture[Extension: precise capture]
  Capture --> Queue[(Extension raw / prepared staging)]
  Queue --> Overlay[Hosted Spotify overlay]
  Overlay --> Processor[Local separation + MP3 workers]
  Processor --> Queue
  Queue -->|256 KiB chunks, retry + commit acknowledgment| Website[ktv420.web.app]
  Website -->|One-song requests| Capture
  Files[Playlist ZIP / folder] <--> Website
  Website <--> Library[(Website IndexedDB: music + catalog)]
  Website --> Worker[Local WebGPU / WASM separation]
  Worker --> Encoder[Local 320 kbps MP3 encoder]
  Encoder --> Library
  Library --> Mixer[Mixer, replay, effects + visualizers]
```

On Spotify, a packaged extension frame embeds the hosted capture playlist as a full-window overlay. Its narrow relay derives the Spotify tab from Chrome’s sender information; no tab ID is exposed in a URL. It never mounts the mixer. Its hosted worker receives verified raw chunks, separates/encodes them while capture continues, and uploads prepared files back to extension staging; it does not store audio in iframe IndexedDB. Track clicks and indexed Spotify links open the corresponding top-level ktv420 playlist/track, paused.

The top-level website owns the lasting playback library. The extension stages raw captures and validated five-file MP3 results until the website imports them. Opening any website page starts resumable delivery; prepared files are copied without encoding. Files, timing/gain metadata, artwork, playlist membership and a receipt commit together before acknowledgment deletes source audio. Imports continue while open, and one failed song does not block others. An interrupted or quota-failed import leaves its source intact. An acknowledgment retry uses its receipt without copying or resurrecting deleted website audio.

Raw captures have exclusive token-bound claims for either an overlay worker or website receiver. Claims expire after two minutes without renewal; chunks and processing progress renew them. A prepared commit validates hashes and MP3 timing before atomically replacing raw staging. Prepared IDs are immutable capture UUIDs; a delayed acknowledgment cannot delete a newer recording. The website separation lock excludes prepared import from active processing/deletion. Both receiving and source final commits request strict IndexedDB durability. Previous overlay-partition files are untouched; normal recapture is supported. No offscreen helper or storage-access permission prompt is used.

`/` and `/catalog` render the catalog; `/playlist` renders the standalone playlist and mixer. `/transfer` and `/replay` work without the extension.

## Ownership and updates

| Website deployment | Extension release |
| --- | --- |
| Library, catalog, import/export, capture order, processing, mixer, effects, visuals and replay | Spotify DOM selectors/discovery, precise capture, temporary delivery storage, website status metadata and versioned operations |

The website’s fresh `ktv420-web-library-v1` IndexedDB database contains tracks, audio Blobs, collections, settings, incoming delivery chunks and commit receipts. Per-song MP3 commits replace raw audio atomically; imported files and metadata commit with collection membership. Processing status remains recoverable from raw input when a worker/tab closes. A website Web Lock excludes competing separation and import/deletion commits. Performance recordings and analysis/model caches remain website-local.

The extension’s new `ktv420-capture-delivery-v1` database contains raw capture manifests/chunks, processing/import claims, temporary output uploads, immutable prepared manifests/Blobs, and a metadata-only website status cache (schema version 4). Previous extension library/state databases are untouched and never opened. Completed queue entries have no automatic expiry. Starting a new capture may clear unfinished staging for that same Spotify tab, but never completed recordings awaiting acknowledgment.

## Protocol and scheduling

`ktv420-spotify`, version 1, is a new protocol. `chrome.runtime.sendMessage` connects a top-level `https://ktv420.web.app` document for delivery operations only. The overlay app uses an origin/source-validated postMessage relay through its packaged parent. The worker accepts Spotify commands only from that extension frame in the enclosing Spotify tab, rejects client-supplied tab IDs, and validates versions, IDs/indexes/volumes and operations:

- `hello`: protocol/extension version.
- `library-summary`: captured/ready metadata plus pending deliveries; no audio.
- `publish-library`: replace status metadata; top-level website only.
- `open-player`: open a website playlist/index matching the bound Spotify route.
- `pending`/`claim-capture`/`chunk`/`ack`/`release-capture`: website raw import with ownership claims.
- `prepared`/`prepared-chunk`/`ack-prepared`: website-only prepared import and committed-result acknowledgment.
- `work-pending`/`work-claim`/`work-chunk`/`work-touch`/`work-release`: sender-bound overlay processing claims and raw reads.
- `work-begin`/`work-append`/`work-finish`: bounded, validated prepared upload. The overlay cannot acknowledge website delivery.
- `discover`, `status`: an identified Spotify tab’s collection and capture state.
- `capture`: one track ID, request UUID and collection path. Retrying the same request reports its status rather than starting another recording.
- `cancel`, `volume`: stop the active primitive or adjust monitoring gain.
- `close`, `view`, `presentation`: close/pause the overlay, synchronize the one-based track URL, or update the Spotify tab title.

No arbitrary code, script injection requests, Chrome API relay or website access to old extension storage is exposed. Host access is limited to Spotify and the app origin. Website iframe storage remains partitioned; audio staging uses the packaged relay instead. No API permissions are requested.

The website holds a capture-scheduler lock and issues one-song requests sequentially, skipping existing inputs. It does not depend on animation frames or an iframe heartbeat. Spotify’s content script verifies complete discovery, route and song identity before recording. The hosted capture playlist and settings render over Spotify; track links open the standalone mixer paused. Close/Escape cancels capture scheduling/separation and pauses Spotify; reopening reuses the frame. Direct website playback remains independent of Spotify. Ordinary Spotify playback is untouched until capture is explicitly requested.

Closing a standalone website tab leaves the Spotify overlay’s scheduling and separation running. Closing the Spotify overlay stops its capture and cancels its worker, releasing the raw claim. The current single capture may finish into the durable queue. Reopening any website page reconnects delivery. The website stores one chunk at a time before requesting the next. Commit receipts prevent duplicate delivery and permit retrying a lost acknowledgment; a later user deletion cannot be undone by an old retry. Transaction failure leaves extension copies available.

## Audio and GPU

The precise capture/worklet pipeline retains its zero-start, sample-clock, source, natural-end and finite-sample checks. Monitor gain is downstream from capture and remains stable through a background website stall; it no longer expires because a hosted iframe missed a heartbeat. Finishing capture releases Spotify audio routing.

The website assembles WAV Blob references without a second full PCM transfer buffer. Demucs and encoding still run in their existing workers. GPU-capable clients explicitly select WebGPU; a GPU initialization failure stays visible and the user can select CPU. Model revision, checksum, Float32 processing, shared MP3 gain and gapless timing are unchanged. Playback has its own clock and no Spotify mirror controller.

Version-2 playlist packages preserve unique audio assets and ordered collection positions, including duplicates. SHA-256, MP3 structural/gapless validation, archive path checks and quotas are checked before committing a song. ZIP export streams, folder/ZIP import works per song, and existing prepared tracks are skipped. No old package support or migration path is included.

## Hosting and verification

Firebase Hosting serves static website/runtime files; model weights come from the pinned data source. No audio upload or backend processing is used. New pages load current code; existing sessions retain their code, with immutable assets retained across deployments.

Automated checks cover delivery interruptions, lost acknowledgments, rollback, duplicates, origin validation, complete ZIP/folder round trips, quota/lock failures and interrupted processing recovery, alongside existing capture/audio/effect/visualizer tests. The standalone development fixture runs the production importer in a real browser. Real Spotify capture and GPU timings must be reported separately from simulated protocol tests.

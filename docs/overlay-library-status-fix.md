# Overlay library status correction

2026-10-31. Hosted fix; extension 7.6.1 remains compatible.

## Observed failure

Native accessibility inspection of the user's Chrome showed every song in Dedicated as Not captured. The top-level catalog showed Dedicated with 10 of 15 captured and 10 ready. Overlay Settings listed only five older short songs (16.6 MiB), while automatic separation was enabled. No audio was deleted or recaptured during inspection.

`usePlaylist` combined the relay's canonical summary with the overlay's own IndexedDB. `sharedSummary` intentionally ignored website rows absent locally. That assumption is invalid for an isolated overlay: a completed capture disappeared as soon as its extension staging entry was acknowledged, even though its five audio files were already saved on the website. It also made the capture scheduler consider those songs missing.

## Correction

- Embedded Spotify views use the complete relay summary, including website-ready records and active queue progress. They never inspect the embedded database to decide whether a song exists.
- Top-level website views retain their local commit authority.
- Failed initial summary requests do not enable capture or render a false Not captured status.
- Discovery no longer writes collection metadata into the overlay's isolated database. The existing extension collection handoff owns that delivery.

Regression coverage checks a ten-ready-song website with unrelated overlay records, recapture skipping, queued/processing/ready transitions, refresh, canonical deletion, and relay errors. Existing queue tests cover revision ordering and deletion publication.

## Limits

The live investigation established that audio and stems survived. It did not exercise another full capture. Browser automation subsequently stopped on a protected URL, so a post-deployment check in the user's Chrome remains outstanding.

Overlay Settings still directly reads its local audio/model caches. That is a separate confirmed inconsistency requiring canonical settings routing; this status correction does not claim to repair it or migrate the legacy isolated audio.

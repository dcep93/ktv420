# Capture and separation lifecycle repair

Approved scope: address the lifecycle audit and provide a website link back to Spotify capture.

## Design

An extension-owned offscreen document hosts one isolated ktv420 worker iframe. Views observe the extension queue, rather than owning inference. Closing or refreshing either UI cannot terminate separation. The packaged relay validates sender and operations; hosted code receives no extension API. Audio remains local. Chrome itself must remain running.

The worker reuses model sessions, falls back from GPU initialization to CPU, exposes actual stages, and retries transient failures with bounded backoff. Permanent failures stay actionable. Replacement worker sessions invalidate obsolete claims. Startup heals orphaned work and incomplete staging; committed input is never discarded by recovery.

Website imports remain durable-before-acknowledgment. Revisioned, live-validated summaries avoid stale readiness. Deletion records a cutoff, serialized with imports; older deliveries cannot resurrect deleted tracks. Newer recaptures replace older audio; artwork can repair independently. Collection snapshots cannot overwrite newer discovery. Shared songs survive deletion of another playlist.

## Implementation and verification

1. Persistent worker host, narrow protocol, startup/close recovery, retry state, atomic summaries.
2. Reusable inference, CPU fallback, encoding watchdog, bounded final verification and storage checks.
3. Durable import/deletion ordering, replacement policy, collection freshness, status publication.
4. Spotify continuation link, stale notice cleanup, current playlist refresh, capture failure isolation.
5. Regression tests for lifecycle, protocol isolation, import/delete and collection changes; complete test/lint/build; package/install extension; publish and check deployment.

## Audit coverage

Worker ownership addresses audit 1–6 and suspension/inner-frame reload (23–24). Runtime changes address 7–10, 25–26. Status changes address 11–14 and 28. Import/collection changes address 15–21 and 27. Capture scheduling addresses 22. Segment progress may restart after a genuine process crash; ordinary view closure no longer restarts it. Recovery must say restarting rather than imply checkpoint resume.

## Self-review

No new cloud processing or audio uploads. No Spotify Connect, autoplay on direct links, storage-access prompt, or separate capture tab. Preserve the overlay. Do not retry invalid captured bytes as valid audio. Tests must distinguish view closure from browser/process termination. Real browser validation remains separate from unit verification.

## Validation

383 automated tests passed, plus ESLint and both production builds. In an isolated Chrome for Testing profile, the real model separated synthetic stereo audio with all visible tabs closed, then the website imported the completed MP3s. A second GPU run deliberately closed the offscreen document during inference: opening the website acquired a replacement claim within about 1.4 seconds and completed/imported the result. The partial playlist rendered its prepared track and a working Spotify continuation link. This validates worker lifetime and delivery; it is not a new end-to-end Spotify recording test.

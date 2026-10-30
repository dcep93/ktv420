# Capture and playlist startup reliability

Four bounded fixes:

- Page reload marks capture as tearing down before requesting stop. Expected bridge shutdown is cancellation: no warning, no failure diagnostic overwrite, no user error on the departing page. Actual capture failures remain logged with readable text and structured JSON.
- Playlist startup reads cached collection metadata first; a new playlist requests only its small metadata handoff. It never acquires the audio delivery lock or waits for prepared audio. Existing polling and deep-link selection pick up songs after their import commits, without autoplay.
- Sample-rate conversion keeps the existing 64-crossing Blackman-windowed sinc filter and endpoint behavior, but caches repeating rational phases. Common sample-rate pairs avoid recalculating trigonometric weights for every output sample. Uncommon large phase tables retain the original direct calculation. No filter quality reduction or artificial progress is introduced.
- Page startup heals claims left by its previous document immediately. The extension binds recovery to Chrome's trusted sender tab/document identity; it removes only that tab's obsolete processing claims and partial output, preserving raw captures, completed stems and other tabs' jobs. Same-document startup is idempotent, and late old-document claims are rejected. Timeout failures carry an explicit retry-after-reload marker; ordinary errors and the user's pause preference remain intact. Worker startup checks cancellation again after asynchronous claiming so a departed view cannot start inference late.

Verify cancellation diagnostics, first-load metadata without audio requests, numerical parity with an independent direct filter, alias suppression and exact output lengths, and ownership-safe recovery including late responses. Benchmark the conversion stage separately from inference. Existing captures and stored stems remain unchanged. Reload suppression and claim recovery require extension 7.4.1; loading and conversion fixes are hosted.

Chrome exposes document identity on MessageSender: https://developer.chrome.com/docs/extensions/reference/api/runtime/#type-MessageSender . The packaged relay's document identifies the Spotify overlay lifetime; top-level website messages use the website document identity. Recovery does not depend on supplied tab IDs.

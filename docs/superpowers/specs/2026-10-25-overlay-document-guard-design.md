# Overlay document guard

The reported origin-mismatch errors come from the periodic state sender retaining a ready flag after its iframe no longer contains the extension broker. The frame's WindowProxy can survive document replacement; validating its identity once is insufficient.

Keep exact origin, window and protocol checks. Before all state, replay and close sends, verify that the extension context is alive, the iframe remains attached with the expected source and no srcdoc override, and any accessible document is the expected broker document. Invalidate readiness when those checks fail, including on load. Reject queued incoming messages from a replaced frame. A restored broker must send a fresh trusted ready message. Do not weaken targetOrigin or suppress console errors after the fact.

Implement the common guard and sender in ui.js, then extend its integration test to cover srcdoc replacement, about:blank navigation, a changed source and extension invalidation. Check state, replay and close paths and handshake recovery. Run tests, lint and build, package 6.3.5 and update the existing unpacked extension folder. Commit locally without pushing. The user must reload the extension and Spotify to replace the already-running content script; historical Chrome error entries remain until cleared.

# Capture stop and listening handoff

An explicit Stop, batch failure or normal completion must silence the hosted player and capture monitor, pause Spotify using its verified DOM transport, and abort partial automatic capture. Publish the stopped state immediately. Hold monitoring at zero while the DOM still describes the previous playing state; allow automatic listening again after an observed pause followed by fresh playback, or an explicit play/select/start command.

Batch-to-listener handoff is different: remote selection or seeking may intentionally continue playback. Do not report that path as a user Stop. Only detect handoff after batch capture progress exists, and clear prior listening snapshots before batch startup so its own initial song selection is not mistaken for an external seek.

Regressions cover immediate silence, a stale playing snapshot after Stop, successful fresh remote playback after pause, and clean handoff without a stopped exception. Run the full suite, lint and build; install extension 6.3.9 in place and commit locally without pushing.

# Inference stall recovery

Observed Champagne remaining at 15% (5/37 completed segments) across inspection. A subsequently restarted run advanced to restoration. The underlying worker failure is unconfirmed. The client currently has no timeout for a worker that silently disappears or never resolves; the queue renews that job forever.

Use a watchdog in the inference client, outside the worker, driven by actual progress messages. Allow at least five minutes without new progress, increasing that allowance to eight times the slowest completed segment in this run. Terminate an unresponsive worker and reject its pending inference with a stage-specific error. Existing queue error handling retains the capture, releases the claim and offers retry. Handle unreadable worker messages similarly. Completion, disposal and explicit worker errors cancel the watchdog.

Report each segment before starting it, without increasing the completed-work fraction. This identifies the operation actually in flight and retains one truthful overall percentage. Do not simulate progress, restart automatically, change audio processing, or require an extension update.

Tests cover silence, slow but progressing inference, duplicate progress, successful cleanup and cancellation. Validate pipeline sample integrity, lint and builds. Live verification must distinguish a recovered run from proof of the original root cause.

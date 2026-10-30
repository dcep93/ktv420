# Clear separation states

Keep the layout and existing pause preferences. Show why a recording is waiting instead of implying active processing. Website summaries carry optional pause/queue metadata and an extension-stamped publication time. After 15 seconds without a publication, unfinished website songs offer opening ktv420 rather than an indefinite spinner. Staged recordings show queued or paused locally; imported recordings describe the website's state independently. Old extensions fall back to an honest captured/open-website label.

Local processing shows its actual phase and progress message. Failed attempts remain visibly retryable until retry or successful handoff. Pausing removes active progress immediately. Website playlist rows show paused instead of queued when disabled. No automatic unpause, new storage library, or audio mutation.

Validate summary parsing, freshness and pause precedence, failure callbacks and cleanup, then run tests/lint/build and deploy. The metadata relay requires an extension reload; hosted UI remains backwards compatible.

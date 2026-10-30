# Extension-owned separation queue

Raw captures stay in extension IndexedDB until all five MP3s are validated and committed. The website imports only prepared results, acknowledges only its durable commit, and never drains raw captures. The same hosted worker may run in a Spotify overlay or top-level ktv420 page, reading/writing extension storage through the validated relay. One queue-wide processing lease prevents competing workers; closure releases the claim, with expiry recovering a crashed view. At least one of these views must remain open; no offscreen/background browser process is introduced.

Pause/resume is shared in extension IndexedDB. Raw failures remain visible and retryable. Both views poll metadata and receive the active stage/percentage. Existing standalone playback and prepared-folder imports remain independent of the extension.

Previously imported unfinished originals are copied back in resumable bounded chunks, retaining the website copy until prepared import replaces it. Strict format checks and idempotent IDs prevent data loss and duplicate copies. Prepared songs are not returned. Old website versions cannot acknowledge/delete unfinished extension audio after the relay update. Unfinished website-only songs require reopening their website once for this migration.

Validate queue ownership, pause, competing views, worker failure/retry, prepared-only imports, resumable migration and commit boundaries. Do not alter user audio manually during testing.

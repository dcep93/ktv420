# Restore extension audio controls

The Spotify overlay's settings must list completed audio still in extension staging, with title, size, original/stem state, per-record deletion and delete-all confirmation. Reuse existing settings styling and grey/pink audio icons. Website imports are not listed or deleted; a short explanation identifies that boundary.

Expose metadata-only staging-list and explicit-ID staging-delete operations exclusively to the packaged overlay. Delete-all submits the displayed IDs, so new captures cannot be swept into an earlier confirmation. Refuse the entire request if a target is incomplete or has an unexpired processing/import claim. Serialize that check and deletion in one strict IndexedDB transaction. Remove raw chunks, partial output, prepared files and staging claims, preserving website library summaries and collection metadata. Prepared file reads hold a renewable transfer claim until acknowledgement or expiry.

Poll only while settings are mounted; show actionable upgrade/load errors. Do not delete real user audio during verification. Test raw and prepared cleanup, partial output, active claim rejection, snapshot safety, scope/authentication, then lint/build and deploy. No new permissions.

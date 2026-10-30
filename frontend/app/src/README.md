# Frontend source layout

- `app/`: route wiring and website services.
- `pages/`: catalog, playlist/mixer, transfer and replay screens.
- `features/local/`: website IndexedDB, collections, processing, capture scheduling/delivery, imports, exports and recordings.
- `features/stems/`: playback engine, effects, visualizers and analysis.
- `shared/`: bounded capture format shared with the optional extension.
- `extension/`: Spotify message dispatcher and temporary delivery queue only. Never import website app or library modules here.

The website must work without Chrome extension APIs. Keep Spotify requests isolated in `features/local/spotify`. Use atomic IndexedDB transactions for audio publication and the website separation lock for processing/import/deletion. Never acknowledge capture delivery until the website transaction commits.

# Frontend Source Layout

The app is organized by responsibility:

- `app/`: application wiring such as route definitions.
- `pages/`: route entry components, one file per route-level page. Keep these flat while they are single-file pages; create a page folder only when a page has multiple private files.
- `features/admin/`: admin-only UI components and controller hooks used by `pages/AdminPage.tsx`.
- `features/sample/`: sample-page hooks and URL/input selection helpers used by `pages/SamplePage.tsx`.
- `features/stems/`: shared stem domain code, including storage services, cached records, playback, object-tree utilities, and metadata.
- `main.tsx`: React mount point only.

Page files should stay thin. Put reusable domain behavior in `features/stems`, feature-specific state in that feature's `hooks/`, and presentational pieces in that feature's `components/`.

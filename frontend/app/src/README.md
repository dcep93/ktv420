# Frontend Source Layout

The app is organized by responsibility:

- `app/`: application wiring such as route definitions.
- `pages/`: route entry components only. Keep this directory flat and TSX-only; page styling and UI composition belong in features.
- `features/admin/`: admin workspace, UI components, and controller hooks used by `pages/AdminPage.tsx`.
- `features/sample/`: sample workspace, hooks, and URL/input selection helpers used by `pages/SamplePage.tsx`.
- `features/stems/`: shared stem domain code, including storage services, cached records, playback, object-tree utilities, and metadata.
- `main.tsx`: React mount point only.

Page files should stay thin. Put reusable domain behavior in `features/stems`, feature-specific state in that feature's `hooks/`, and presentational pieces and CSS in that feature's `components/`.

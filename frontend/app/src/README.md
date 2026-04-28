# Frontend Source Layout

The app is organized by responsibility:

- `app/`: application wiring such as route definitions.
- `pages/`: thin route targets that are not tied to a feature workflow.
- `features/admin/`: admin-only UI and controller hooks.
- `features/sample/`: sample-page UI, hooks, and URL/input selection helpers.
- `features/stems/`: shared stem domain code, including storage services, cached records, playback, object-tree utilities, and build metadata.
- `main.tsx`: React mount point only.

Feature pages should stay thin. Put reusable domain behavior in `features/stems`, feature-specific state in that feature's `hooks/`, and presentational pieces in that feature's `components/`.

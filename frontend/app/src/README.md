# Frontend Source Layout

The app is organized by responsibility:

- `app/`: application wiring such as route definitions.
- `pages/`: route entry components only. Keep this directory flat and TSX-only; page styling and UI composition belong in features.
- `features/stems/`: shared stem domain code, including storage services, cached records, playback, object-tree utilities, and metadata.
- `main.tsx`: React mount point only.

Page files should stay thin. Put reusable domain behavior in `features/stems`, feature-specific state in that feature's `hooks/`, and presentational pieces and CSS in that feature's `components/`.

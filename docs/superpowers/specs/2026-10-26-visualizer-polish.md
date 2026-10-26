# Visualizer polish and audit

Implement the user's requested Super Time Ribbon stability fix, combined-scene height toggle and slowly evolving Highway palette. Audit all thirty choices and propose (do not remove/add) two cuts and four new concepts.

Super Time Ribbon shares fixed source-envelope vertices and smoothed spectral color with Time Ribbon. Preserve its identity with bounded, smoothed waveform motion; keep the seek line/grid stationary. Silence, pause, seeks and compact panels must remain finite and stable.

Combined scenes use an accessible clickable canvas within a shared panel component. Click, Enter or Space toggles the panel between its current compact height and 100vh in the page flow. Keep the legend visible, focus indication and action hint. No Fullscreen API or sticky overlay; existing Escape closes/pauses the app. Retain the choice while changing scenes within this player.

Highway interpolates coordinated HSL palette anchors over sixty-second eased intervals using song time. All sky/sun/road/scenery colors follow the palette, with restrained slow star twinkle. Keep the existing projection, mute behavior and bounded geometry. Pause freezes evolution; seeking selects the matching palette without a random reset.

Fix evident audit defects: Spectrum Safari's loudest-bin color jumps, Cascade Horizon's per-frame random star positions, Ectoplasm's discontinuous spark angles, and Laser Ladders' offscreen bars/unscaled height. Other artistic redesigns remain recommendations.

Test fixed-vertex translation, motion/color bounds, palette continuity, render invariants across all choices, and accessible height toggle in the actual browser. Inspect screenshots at compact/full height, benchmark expanded Highway, run tests/lint/build, commit and deploy. Record limits: synthetic fixtures cannot establish subjective quality for every song/device.

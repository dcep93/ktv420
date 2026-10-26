# Visualizer picker organization

Group the picker into Scenes (combined views), Signal (waveforms, frequency and stereo views), and Patterns (abstract per-stem visuals). Keep related choices adjacent, including both Time Ribbons. Keep Beach first so the default does not change. Derive the flat keyboard-cycle order from the same groups; preserve all IDs and retired replay support.

Use a shared responsive grid with equal-width buttons across every group, including incomplete final rows. Preserve active styling, accessible pressed state and hints; allow long names to wrap. Canvas widths already share the available panel width and do not need changing. Extract the picker into a small component so preview and production use identical markup.

Alternatives: alphabetical ordering separates related views; a single unlabelled grid makes the combined/per-stem distinction harder to discover. Verify all previous choices remain present once, keyboard traversal follows display order, selection works, and widths match at wide and compact desktop sizes. Run existing tests, lint/build, then deploy.

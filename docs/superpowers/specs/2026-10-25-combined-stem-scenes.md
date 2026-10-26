# Combined stem scenes

User requested design, implementation and deployment, then explicitly selected one combined scene like current Stem Weather rather than individual stem panels.

Add Night City, Stem Garden and Orbit to the existing visualizer selector. Retain Stem Weather unchanged. Each mode renders one shared canvas above the existing mixer rows, with a short four-part legend. Do not alter audio routing or add controls. Track spotlight is disabled for every combined scene, including when replay restores a snapshot. Existing recordings and visualizer identifiers stay compatible.

Night City maps bass to a layered skyline, drums to window flashes, vocals to a neon sky trail, and other to distant haze. Stem Garden maps bass to roots, drums to floating seeds, vocals to a climbing vine, and other to opening leaves. Orbit maps bass to a central star, drums to expanding rings, vocals to a comet with a curved tail, and other to constellations. Each contribution must stand alone when soloed. An audible original supplies a separate warm halo; do not pretend to infer separated instruments from the original.

Use the existing post-mixer analysers, cached waveform buffers and fixed-scale energy so faders and effects visibly matter. Shared role classification and scene metadata prevent special-case UI branches. New rendering state is per canvas and reset on seek, track/mode change and hidden-to-visible transition. Explicit mute removes that role immediately; paused time stops geometric motion. Cap shapes and sample points, avoid particle growth and new audio branches, use existing capped Retina resolution, and skip hidden canvases.

Validation: regression checks for role isolation, mute/solo, fader energy, seek reset, bounded geometry, balanced canvas state and stable selector identities. Use the local visual preview with synthetic audio to inspect all scenes, mute and pause, and measure render overhead. Run test/lint/build, push main, confirm hosting deployment and live asset hashes. No extension permission or version change is needed.

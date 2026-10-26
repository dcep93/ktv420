# Highway: periodic desert and music-driven sky

The desert scenery should evolve independently of stem volume. A smooth 60-second cycle brings cactus-rich stretches and more open scenery. Mountains remain readable, with existing slow parallax and coordinated palette evolution.

Other controls time of day: a fixed-scale intensity target feeds a slow daylight average, with a maximum full-range slew of 35 seconds and an 18-second smoothing constant. Short transients cannot switch the scene between day and night. Initial view starts at twilight. Pausing freezes the atmosphere; seeking resets onset detection without jumping daylight.

Frequent rhythmic attacks in Other increase a smoothed sky-density value. Daylight reveals softly drifting cloud clusters; darkness reveals a fixed seeded star field. Fade individual objects with density rather than changing integer counts abruptly. No BPM detection or new audio nodes are needed. Original audio provides the existing fallback contribution.

Retain bass road glow, drum lights, vocal disc and minute-long palette movement. Update the Other legend to sky. Keep object counts and buffers bounded. Test intensity direction, time constants, attack-rate response, pause/seek behavior, periodic scenery, finite drawing and compact/large browser rendering. Deploy after checks pass.

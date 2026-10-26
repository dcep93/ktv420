# Manual pedal Wah

The current Wah mixes a large dry component underneath a broad bandpass. It sounds like a moving EQ rather than a focused pedal. Restore a pronounced manual sweep while preserving the explicitly requested clean center, existing bypass, recording IDs, and shared live/export processor.

Use a two-pole, single-DC-zero resonator, informed by the documented CryBaby model in the Faust vaeffects library. Sweep logarithmically from 400 to 2000 Hz (within Dunlop GCB95 specifications), with a tighter heel resonance and a broader toe resonance. Normalize the resonant gain to 3 rather than applying a guitar pedal's full voltage gain to mastered recordings. Fully engage outside a short, smooth center transition. Center and bypass remain exact dry samples. Keep channels independent and all filter state warm during bypass.

Alternatives: increasing the existing dry-plus-bandpass boost would retain the wrong spectral shape; a full nonlinear circuit simulation would add complexity without measurements of the user's pedal. This is a deliberately headroom-controlled approximation, not an exact circuit clone. Crossing clean center differs from the real pedal, whose toe switch supplies bypass.

Verify the audible frequency contour at production sample rates, off-band rejection, smooth movement through center, finite output under full-scale automation, stereo isolation, unchanged other effects, and browser live/export parity. No new controls, automatic motion, panning, or extension changes.

References: https://www.jimdunlop.com/content/manuals/GCB95.pdf and https://faustlibraries.grame.fr/libs/vaeffects/#vacrybaby .

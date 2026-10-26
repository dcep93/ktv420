# Time Ribbon stability

Keep the existing per-track ribbon and its five-second past / fifteen-second
future window, including the quarter-width playhead and click-to-seek mapping.
Resolve visual flicker without changing playback or capture.

The former renderer selected the loudest frequency bin every frame and sampled
the envelope against screen pixels. Competing spectral peaks could abruptly
recolor the entire ribbon; scrolling narrow envelope peaks could change their
apparent shape as the sample phase crossed pixel boundaries.

Draw the existing 50 ms envelope samples at song-anchored positions, translating
all vertices together. Use an energy-weighted spectral centroid for color with
shortest-path hue smoothing and a bounded transition speed. Preserve color on
pause and silence, and bound transitions after seeks. Use the shared Retina
canvas setup, theme background, subtle fill and song-anchored grid. Keep roughly
403 envelope vertices per frame regardless of canvas width; reuse FFT buffers.

Super Time Ribbon and audio/replay timing remain unchanged. The development-only
`ribbon-preview.html` exercises the production renderer at wide and compact sizes
with narrow waveform peaks and alternating near-equal frequency-bin winners.
It is excluded from production build inputs.

Validation: 141 automated tests, lint and hosted/extension builds passed.
Regression tests cover rigid waveform translation, bounded hue changes, silence,
pause, seeks, short canvases, finite drawing coordinates and balanced canvas state.
Browser inspection exercised scrolling, pause, a fifteen-second seek and resume
with the synthetic alternating-spectrum fixture. This is not a real-song
end-to-end playback test.

# Effects character repair

The previous rebuild tested transparency and bounded output, but did not require Wah to emphasize its selected band. Its unity-peak bandpass could only remove spectral energy; increasing the effect mostly thinned and quieted the source. The old test explicitly forbade resonant gain. Echo also reduced both the dry signal and first-repeat level as feedback increased.

## Changes

- Wah retains exact clean center, with a smooth engagement curve, up to about 8.5 dB of small-signal resonant emphasis and a substantial off-band dry path. This restores the sweep without restoring the old extreme gain.
- Envelope Filter and Vowels retain more body and give their resonant bands useful gain.
- Echo retains at least 80% of the dry attack; its first-repeat amount is independent of feedback normalization. Timing/BPM controls are unchanged.
- Chorus and Flanger have wider delay modulation, and Phaser uses six stages. Modulation blend engages earlier. No panning was added.
- Telephone, DJ Filter, Tone, Reverb and Saturation retain their processing character. A smooth peak ceiling protects active processed output, including gain-heavy resonances, without changing exact neutral/bypass. This is per effect, not a guarantee about summed multi-stem master peaks.

## Evidence and limits

A deterministic 44.1 kHz bass/chord/percussion fixture measured maximum-setting RMS relative to dry:

| Effect | Previous | Revised |
| --- | ---: | ---: |
| Wah | −16.4 dB | −3.7 dB |
| Envelope Filter | −16.3 dB | −6.8 dB |
| Vowels | −9.0 dB | +0.5 dB |
| Echo | −10.5 dB | −3.9 dB |

These are fixture-specific levels, not loudness targets for every song. Echo's tail RMS rose from 0.00698 to 0.02355 on the same fixture. Reverb and Saturation were already audible and were not given extra gain.

Signal tests now require a moving Wah resonance above off-band energy, preserved body, audible first echoes, vowel emphasis, production-rate stereo isolation/headroom, and continuity through clean center. Existing neutral, bypass, tail, envelope, smoothing and deterministic automation tests remain. All 164 repository tests pass.

The actual browser AudioWorklet matched the pure DSP for all 12 selectable effects at both 44.1 and 48 kHz (24 comparisons, largest sample difference below 4e−8). A one-second synthetic comparison loop cost approximately 0.012–0.031 ms per 128 samples, including sample comparison overhead. This is not a live multi-stem glitch/latency benchmark. Numeric checks demonstrate processing behavior; the final subjective judgment still requires listening to the user's music.

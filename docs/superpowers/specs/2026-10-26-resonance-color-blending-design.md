# Resonance Plate color blending

The renderer currently paints overlapping rectangles in fixed stem order. At a halfway transition, the later color overwrites the earlier one instead of crossfading. Blend each grain's two neighboring palette colors before painting it once. Original remains excluded.

Use cosine phase weights and premultiplied color contributions: contribution = phase weight × clamped stem level cubed; opacity is their sum and RGB is their opacity-weighted average. This preserves the existing quiet/peak response when adjacent levels match, removes muted colors without renormalizing brightness, and makes the fourth-to-first transition continuous. Preserve grain anchors, artwork weights, four-color palette, playback-time movement, fallback artwork, and no brightness floor.

Group grains into 128 cached phase buckets so the draw loop uses bounded batched fills rather than thousands of style changes. Phase advances continuously; only initial seeded phases are quantized. Grain size uses the phase-weighted squared existing size factors, preserving area while combining two old rectangles into one.

Validate halfway blends for all four palette pairs, muted colors, unequal levels, peak/quiet response, Original exclusion, deterministic pause, wrap continuity, and single paint per grain. Inspect a synthetic browser preview and benchmark full-size art. Deploy only this hosted renderer change; no extension update or audio changes.

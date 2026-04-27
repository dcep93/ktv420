import { collectTrackRows, visibleTrackMatches } from "./dom.js";
import { looselyMatches, normalizeText } from "./text.js";

export function resolveCurrentPlaybackTrack(snapshot, visibleRows = collectTrackRows()) {
  const media = snapshot?.mediaSession || null;

  if (media?.title) {
    const visibleMatches = visibleRows.filter((row) => visibleTrackMatches(row, media));
    const uniqueIds = new Set(visibleMatches.map((row) => row.trackId));

    if (uniqueIds.size === 1) {
      const row = visibleMatches[0];
      return {
        trackId: row.trackId,
        name: row.trackName,
        artist: row.trackArtist || media.artist || "",
        source: "media-session-visible-tracklist",
        confidence: 220
      };
    }
  }

  const networkWinner = resolveNetworkWinner(snapshot?.observations || [], media);

  if (networkWinner) {
    return networkWinner;
  }

  if (media?.title) {
    return {
      trackId: null,
      name: media.title,
      artist: media.artist || "",
      source: "media-session",
      confidence: 100
    };
  }

  return null;
}

function resolveNetworkWinner(observations, media) {
  const scored = [];

  for (const observation of observations) {
    for (const candidate of observation.candidates || []) {
      if (!candidate.trackId) {
        continue;
      }

      const score = scoreCandidate(candidate, media);
      if (score.rejected) {
        continue;
      }

      scored.push({
        trackId: candidate.trackId,
        name: candidate.name || "",
        artist: candidate.artist || "",
        source: "spotify-playback-state",
        confidence: score.value,
        observedAt: observation.observedAt,
        path: candidate.path || ""
      });
    }
  }

  if (scored.length === 0) {
    return null;
  }

  const grouped = new Map();
  for (const item of scored) {
    const existing = grouped.get(item.trackId);
    if (!existing || item.confidence > existing.confidence || item.observedAt > existing.observedAt) {
      grouped.set(item.trackId, item);
    }
  }

  const winners = Array.from(grouped.values()).sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.observedAt - a.observedAt;
  });

  const top = winners[0];
  if (!top || top.confidence <= 0) {
    return null;
  }

  const bestIds = new Set(winners.filter((winner) => winner.confidence === top.confidence).map((winner) => winner.trackId));
  if (bestIds.size !== 1) {
    return null;
  }

  return top;
}

function scoreCandidate(candidate, media) {
  let score = 0;
  const pathText = normalizeText(candidate.path || "");
  const hintText = normalizeText(`${candidate.path || ""} ${(candidate.keys || []).join(" ")}`);

  if (/\b(player state|player_state|now|current|playing)\b/.test(hintText)) {
    score += 80;
  }
  if (/\b(track|item|episode)\b/.test(hintText)) {
    score += 40;
  }
  if (/\b(queue|next|previous|recent|history|context|playlist|album)\b/.test(pathText)) {
    score -= 80;
  }
  if (candidate.isPlaying === true) {
    score += 30;
  }

  if (media?.title && candidate.name) {
    if (!looselyMatches(candidate.name, media.title)) {
      return { rejected: true };
    }
    score += 100;
  } else if (media?.title) {
    score -= 25;
  }

  if (media?.artist && candidate.artist) {
    if (!looselyMatches(candidate.artist, media.artist)) {
      return { rejected: true };
    }
    score += 100;
  } else if (media?.artist) {
    score -= 10;
  }

  if (candidate.name) score += 20;
  if (candidate.artist) score += 20;

  return { rejected: false, value: score };
}

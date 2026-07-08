export function normalizeTimingTrace(value) {
  if (value && typeof value === "object" && typeof value.id === "string") {
    const startWallMs = Number(value.startWallMs) || Date.now();
    return {
      id: value.id,
      source: typeof value.source === "string" ? value.source : "ktv420_unknown",
      startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date(startWallMs).toISOString(),
      startWallMs,
      events: Array.isArray(value.events)
        ? value.events.filter((event) => event && typeof event.name === "string")
        : []
    };
  }

  const startWallMs = Date.now();
  return {
    id: `${startWallMs}-${Math.random().toString(36).slice(2, 10)}`,
    source: "ktv420_content",
    startedAt: new Date(startWallMs).toISOString(),
    startWallMs,
    events: []
  };
}

export function markTiming(trace, name, details = null) {
  if (!trace || !name) {
    return;
  }

  const atMs = Date.now();
  trace.events.push({
    name,
    atMs,
    deltaFromClickMs: atMs - trace.startWallMs,
    ...(details ? { details: sanitizeTimingDetails(details) } : {})
  });
}

function sanitizeTimingDetails(details) {
  const clean = {};

  for (const [key, value] of Object.entries(details)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = value
        .filter((item) => typeof item === "string" || typeof item === "number")
        .slice(0, 20);
    }
  }

  return clean;
}

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

export function logTimingReport(trace, outcome, details = null) {
  if (!trace) {
    return;
  }

  markTiming(trace, outcome, details);

  const report = {
    type: "ktv420_timing",
    outcome,
    traceId: trace.id,
    source: trace.source,
    startedAt: trace.startedAt,
    totalFromClickMs: Date.now() - trace.startWallMs,
    durationsMs: summarizeDurations(trace.events),
    events: trace.events
  };

  console.log(JSON.stringify(report));
}

function summarizeDurations(events) {
  const starts = new Map();
  const durations = {};

  for (const event of events) {
    if (event.name.endsWith("_start")) {
      starts.set(event.name.slice(0, -"start".length), event.atMs);
      continue;
    }

    if (!event.name.endsWith("_end")) {
      continue;
    }

    const key = event.name.slice(0, -"end".length);
    const startAt = starts.get(key);
    if (typeof startAt === "number") {
      durations[key.replace(/_$/, "")] = event.atMs - startAt;
    }
  }

  return durations;
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

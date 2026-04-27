export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function looselyMatches(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a || !b) {
    return false;
  }

  if (a === b || a.includes(b) || b.includes(a)) {
    return true;
  }

  const aTokens = new Set(a.split(" "));
  const bTokens = b.split(" ");
  const shared = bTokens.filter((token) => aTokens.has(token)).length;
  return shared / Math.max(aTokens.size, bTokens.length) >= 0.6;
}

export function formatSeconds(value) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safe < 0.001) {
    return "0";
  }

  return String(Number(safe.toFixed(3))).replace(/\.0+$/, "");
}

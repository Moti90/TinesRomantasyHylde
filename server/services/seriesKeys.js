export function seriesCanonicalKey(seriesName) {
  const name = String(seriesName || "").trim().toLowerCase();
  if (!name) return null;
  return `series:${name}`;
}

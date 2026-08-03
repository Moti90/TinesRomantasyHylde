/**
 * Goodreads-feltet må KUN indeholde verificerede Goodreads-tal.
 * Open Library / Google Books må aldrig gemmes eller vises som Goodreads.
 */

export function isCatalogRatingDisguise(value) {
  const s = String(value || "").toLowerCase();
  return (
    s.includes("open library") ||
    s.includes("google books") ||
    s.includes("googlebooks")
  );
}

export function parseRatingNumber(value) {
  if (value == null || value === "" || value === "Ikke verificeret") return null;
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value >= 0 && value <= 5 ? value : null;
  }
  if (isCatalogRatingDisguise(value)) return null;
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return !Number.isNaN(n) && n >= 0 && n <= 5 ? n : null;
}

/**
 * Rens en værdi til lagring i Goodreads-score-kolonnen.
 * Returnerer number | null — aldrig OL/GB-strenge.
 */
export function sanitizeGoodreadsScore(value) {
  if (value == null || value === "" || value === "Ikke verificeret") return null;
  if (isCatalogRatingDisguise(value)) return null;
  return parseRatingNumber(value);
}

/**
 * Vælg Goodreads til gemning:
 * - verifiedGoodreads (fra webresearch) vinder
 * - ellers behold existing (renset), hvis preserveExisting
 * - ellers null
 */
export function resolveGoodreadsScore({
  verifiedGoodreads = null,
  existingValue = null,
  preserveExisting = true,
} = {}) {
  if (verifiedGoodreads != null && verifiedGoodreads.value != null) {
    const n = Number(verifiedGoodreads.value);
    if (!Number.isNaN(n) && n >= 0 && n <= 5) return n;
  }
  if (preserveExisting) {
    return sanitizeGoodreadsScore(existingValue);
  }
  return null;
}

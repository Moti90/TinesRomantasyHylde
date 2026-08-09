import { stableHash } from "./hash.js";

export const REVIEW_SUMMARY_VERSION = "review-summary-v2";

export function reviewSummaryKey(book) {
  const isSeries = Boolean(book?.isSeries);
  return stableHash({
    version: REVIEW_SUMMARY_VERSION,
    scope: isSeries ? "series" : "book",
    sourceBookId: isSeries
      ? ""
      : String(book?.sourceBookId || "").trim().toLowerCase(),
    title: String(
      isSeries
        ? book?.seriesName || book?.displayTitle || book?.firstBookTitle || ""
        : book?.firstBookTitle || book?.displayTitle || ""
    )
      .trim()
      .toLowerCase(),
    author: String(book?.author || "").trim().toLowerCase(),
  });
}

export function normalizeReviewSummary(raw) {
  const shortSummary = String(raw?.shortSummary || "").trim().slice(0, 1600);
  const spoilerPoints = Array.isArray(raw?.spoilerPoints)
    ? raw.spoilerPoints
        .map((point) => String(point || "").trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  if (!shortSummary) throw new Error("Der blev ikke lavet et brugbart resumé");
  return {
    shortSummary,
    spoilerPoints,
    note: String(raw?.note || "").trim().slice(0, 500) || null,
  };
}

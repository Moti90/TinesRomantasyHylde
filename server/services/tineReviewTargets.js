function normalizePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Map catalog identity to a review target.
 * Prefer series when available; otherwise treat as standalone book.
 */
export function mapIdentityToReviewTarget(identity = {}) {
  const title = String(identity.title || "").trim();
  const author = String(identity.author || "").trim() || null;
  const series = String(identity.series || "").trim() || null;
  const isSeries = Boolean(series);
  const seriesName = series || title || null;
  const sourceBookId = [
    "identity",
    normalizePart(seriesName),
    normalizePart(title),
    normalizePart(author),
  ].join("|");

  return {
    sourceBookId,
    source: "identity",
    displayTitle: isSeries ? seriesName : title,
    seriesName,
    firstBookTitle: title || seriesName,
    author,
    isSeries,
    bookNumber: identity.bookNumber ?? null,
    identityConfidence:
      identity.identityConfidence || identity.confidence || null,
    identity: {
      title: title || null,
      author,
      series,
      bookNumber: identity.bookNumber ?? null,
      identityConfidence:
        identity.identityConfidence || identity.confidence || null,
    },
  };
}

export function reviewTargetLabel(target) {
  if (!target) return "Ukendt";
  if (target.isSeries) {
    return `Serie: ${target.seriesName}`;
  }
  return `Standalone: ${target.firstBookTitle || target.displayTitle}`;
}

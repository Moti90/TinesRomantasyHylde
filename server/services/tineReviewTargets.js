import { loadSeries } from "./store.js";
import {
  authorMatch,
  extractSeriesFromText,
  norm,
  titleSimilarity,
} from "./identify.js";

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

function rowToIdentity(row, extras = {}) {
  const seriesName = String(row["Seriens navn"] || "").trim();
  const firstBook = String(row["Første bog/titel"] || "").trim();
  const author = String(row["Forfatter"] || "").trim() || null;
  return {
    title: firstBook || seriesName,
    author,
    series: seriesName || null,
    bookNumber: null,
    identityConfidence: extras.identityConfidence || "high",
    source: "local-library",
  };
}

/**
 * Match titel/serienavn/forfatter mod det lokale bibliotek.
 * Serienavne i biblioteket har høj prioritet ved anmeldelsessøgning.
 */
export function matchLocalLibrary({ query = "", author = "" } = {}) {
  const q = String(query || "").trim();
  const authorHint = String(author || "").trim();
  if (!q && !authorHint) return null;

  const authorOnly = !q && Boolean(authorHint);
  const list = loadSeries();
  const scored = list
    .map((row) => {
      const seriesName = String(row["Seriens navn"] || "").trim();
      const firstBook = String(row["Første bog/titel"] || "").trim();
      const rowAuthor = String(row["Forfatter"] || "").trim();
      const seriesScore = q ? titleSimilarity(seriesName, q) : 0;
      const titleScore = q ? titleSimilarity(firstBook, q) : 0;
      const a = authorMatch(rowAuthor, authorHint || null);
      let score;
      if (authorOnly) {
        score = a.score;
        if (!a.matched) score = 0;
      } else {
        score =
          Math.max(seriesScore, titleScore) * (authorHint ? 0.6 : 0.85) +
          a.score * (authorHint ? 0.4 : 0.15);
        if (seriesScore >= 0.85) score = Math.max(score, 0.9 + a.score * 0.08);
        if (authorHint && !a.matched && Math.max(seriesScore, titleScore) < 0.95) {
          score *= 0.3;
        }
      }
      return { row, score, seriesScore, titleScore, authorMatched: a.matched };
    })
    .filter((x) => x.score >= (authorOnly ? 0.75 : 0.55))
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  if (authorOnly) {
    return {
      status: "ambiguous",
      candidates: scored.slice(0, 8).map(({ row }) => {
        const identity = rowToIdentity(row);
        return {
          title: identity.title,
          author: identity.author,
          series: identity.series,
          bookNumber: null,
          year: null,
          source: "Lokalt bibliotek",
          identityConfidence: "high",
        };
      }),
      userMessage: "Flere serier af forfatteren i dit bibliotek. Vælg den rigtige.",
    };
  }

  const top = scored[0];
  // Tydeligt serienavn-hit → serie direkte
  if (top.seriesScore >= 0.75) {
    return {
      status: "identified",
      identity: rowToIdentity(top.row),
      candidates: scored.slice(0, 5).map(({ row }) => {
        const identity = rowToIdentity(row);
        return {
          title: identity.title,
          author: identity.author,
          series: identity.series,
          bookNumber: null,
          year: null,
          source: "Lokalt bibliotek",
          identityConfidence: "high",
        };
      }),
    };
  }

  // Flere næsten lige gode hits → valg
  const rivals = scored.filter(
    (x, i) =>
      i > 0 &&
      x.score >= 0.7 &&
      Math.abs(x.score - top.score) < 0.12 &&
      norm(x.row["Seriens navn"]) !== norm(top.row["Seriens navn"])
  );
  if (rivals.length) {
    return {
      status: "ambiguous",
      candidates: [top, ...rivals].slice(0, 5).map(({ row }) => {
        const identity = rowToIdentity(row);
        return {
          title: identity.title,
          author: identity.author,
          series: identity.series,
          bookNumber: null,
          year: null,
          source: "Lokalt bibliotek",
          identityConfidence: "high",
        };
      }),
      userMessage: "Flere serier i biblioteket matcher. Vælg den rigtige.",
    };
  }

  if (top.score >= 0.7) {
    return {
      status: "identified",
      identity: rowToIdentity(top.row),
      candidates: [],
    };
  }

  return null;
}

/**
 * Hvis katalog-identitet mangler serie, berig fra lokal række eller titelparantes.
 */
export function enrichIdentityWithLocalSeries(identity = {}) {
  if (!identity) return identity;
  const next = { ...identity };
  if (!next.series) {
    const extracted = extractSeriesFromText(next.title);
    if (extracted.series) {
      next.series = extracted.series;
      if (extracted.bare) next.title = extracted.bare;
      if (extracted.bookNumber != null) next.bookNumber = extracted.bookNumber;
    }
  }
  if (next.series) return next;

  const local = matchLocalLibrary({
    query: next.title || "",
    author: next.author || "",
  });
  if (local?.status === "identified" && local.identity?.series) {
    return {
      ...next,
      series: local.identity.series,
      author: next.author || local.identity.author,
      title: next.title || local.identity.title,
      identityConfidence: next.identityConfidence || "medium",
    };
  }
  return next;
}

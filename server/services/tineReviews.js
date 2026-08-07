import { existsSync, readFileSync, writeFileSync } from "fs";
import { dataPath } from "./paths.js";
import { emptySeries } from "./columns.js";
import { loadSeries, upsertSeries } from "./store.js";

const REVIEWS_FILE = dataPath("tine-reviews.json");

function readReviewsFile() {
  if (!existsSync(REVIEWS_FILE)) {
    return { reviews: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(REVIEWS_FILE, "utf8"));
    return { reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [] };
  } catch {
    return { reviews: [] };
  }
}

function saveReviewsFile(data) {
  const cleaned = {
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
  };
  writeFileSync(REVIEWS_FILE, JSON.stringify(cleaned, null, 2), "utf8");
  return cleaned;
}

function reviewKey({ seriesName, firstBookTitle, author }) {
  return [seriesName, firstBookTitle, author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function sourceReviewKey(review) {
  return String(review?.sourceBookId || "").trim().toLowerCase();
}

function sameReview(a, b) {
  const aSource = sourceReviewKey(a);
  const bSource = sourceReviewKey(b);
  if (aSource && bSource) return aSource === bSource;
  return reviewKey(a) === reviewKey(b);
}

function seriesReviewKey(review) {
  return [review?.seriesName || review?.firstBookTitle, review?.author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function average(values) {
  const valid = values.filter(
    (value) => typeof value === "number" && !Number.isNaN(value)
  );
  if (!valid.length) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

export function buildLibraryRowFromReviews(reviews, existing = null) {
  const scored = (reviews || []).filter(
    (review) =>
      typeof review?.overallScore === "number" &&
      !Number.isNaN(review.overallScore)
  );
  if (!scored.length) return null;

  const latest = [...scored].sort(
    (a, b) =>
      Date.parse(b.updatedAt || b.createdAt || 0) -
      Date.parse(a.updatedAt || a.createdAt || 0)
  )[0];
  const seriesName = latest.seriesName || latest.firstBookTitle;
  const subjectiveKeys = new Set(
    scored.flatMap((review) => Object.keys(review.subjectiveScores || {}))
  );
  const subjectiveAverages = {};
  for (const key of subjectiveKeys) {
    const score = average(
      scored.map((review) => Number(review.subjectiveScores?.[key]?.score))
    );
    if (score != null) subjectiveAverages[key] = score;
  }
  const reviewedBooks = scored.map((review) => ({
    sourceBookId: review.sourceBookId || null,
    title: review.firstBookTitle || null,
    goodreadsUrl: review.goodreadsUrl || null,
    score: review.overallScore,
    rereadChoice: review.rereadChoice || null,
  }));
  const priorOrigin = existing?._origin || null;
  const base = existing || emptySeries();

  return {
    ...base,
    Status: "Læst",
    "Seriens navn": seriesName,
    "Første bog/titel":
      existing?.["Første bog/titel"] || scored[0].firstBookTitle || seriesName,
    Forfatter: latest.author || existing?.Forfatter || null,
    "Tines score": average(scored.map((review) => review.overallScore)),
    "Tines egen vurdering":
      latest.comment || existing?.["Tines egen vurdering"] || null,
    _origin:
      priorOrigin ||
      {
        type: "tine_reviews",
        label: "Fra Tines anmeldelser",
        createdAt: new Date().toISOString(),
      },
    _tineReviews: {
      count: scored.length,
      averageScore: average(scored.map((review) => review.overallScore)),
      subjectiveAverages,
      reviewedBooks,
      updatedAt: latest.updatedAt || latest.createdAt || new Date().toISOString(),
    },
  };
}

function syncScoredReviewToLibrary(review, reviews) {
  if (review.overallScore == null) return;
  const key = seriesReviewKey(review);
  const related = reviews.filter((row) => seriesReviewKey(row) === key);
  const existing =
    loadSeries().find((row) => {
      const rowKey = seriesReviewKey({
        seriesName: row["Seriens navn"],
        author: row.Forfatter,
      });
      return rowKey === key;
    }) || null;
  const libraryRow = buildLibraryRowFromReviews(related, existing);
  if (libraryRow) upsertSeries(libraryRow);
}

export function listTineReviews() {
  return readReviewsFile().reviews;
}

export function upsertTineReview(review) {
  const data = readReviewsFile();
  const now = new Date().toISOString();
  const idx = data.reviews.findIndex((row) => sameReview(row, review));
  const existing = idx >= 0 ? data.reviews[idx] : null;
  const next = {
    ...review,
    updatedAt: now,
    createdAt: existing?.createdAt || review.createdAt || now,
  };
  if (idx >= 0) {
    data.reviews[idx] = { ...data.reviews[idx], ...next };
  } else {
    data.reviews.push(next);
  }
  const reviews = saveReviewsFile(data).reviews;
  syncScoredReviewToLibrary(next, reviews);
  return reviews;
}

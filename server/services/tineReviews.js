import { existsSync, readFileSync, writeFileSync } from "fs";
import { dataPath } from "./paths.js";

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

export function listTineReviews() {
  return readReviewsFile().reviews;
}

export function upsertTineReview(review) {
  const data = readReviewsFile();
  const now = new Date().toISOString();
  const key = reviewKey(review);
  const idx = data.reviews.findIndex((row) => reviewKey(row) === key);
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
  return saveReviewsFile(data).reviews;
}

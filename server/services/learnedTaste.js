import { existsSync, readFileSync, writeFileSync } from "fs";
import { dataPath } from "./paths.js";
import { getTineFieldWeight } from "./decisionScores.js";

const LEARNED_PATH = dataPath("learned-taste.json");
const REVIEWS_PATH = dataPath("tine-reviews.json");

function readReviewsFromDisk() {
  if (!existsSync(REVIEWS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(REVIEWS_PATH, "utf8"));
    return Array.isArray(parsed.reviews) ? parsed.reviews : [];
  } catch {
    return [];
  }
}

const SHORT_LABELS = {
  "Rhysand-faktoren": "Rhysand-faktoren",
  "Beskyttende helt(e) (0-5)": "beskyttende helt",
  "Bodyguard-vibe (0-5)": "bodyguard-vibe",
  "Touch her and die-vibe (0-5)": "touch-her-and-die",
  "Kvindelig udvikling (0-5)": "kvindelig udvikling",
  "Karakterudvikling (0-5)": "karakterudvikling",
  "Spice/erotik kvalitet (0-5)": "spice-kvalitet",
  "Spice/erotik (0-5)": "spice",
  "Book hangover (0-5)": "book hangover",
  "Episk plot (0-5)": "episk plot",
  "Worldbuilding (0-5)": "worldbuilding",
  "Politiske intriger (0-5)": "politiske intriger",
  "Krig/militær (0-5)": "krig/militær",
  "Romance i fokus (0-100%)": "romance i fokus",
  "Hvor hurtigt griber den? (0-100%)": "greb",
};

const EMPTY = {
  version: "learned-taste-v1",
  reviewCount: 0,
  scoredReviewCount: 0,
  updatedAt: null,
  fieldPrefs: {},
  positiveTags: {},
  negativeTags: {},
  reread: { yes: 0, maybe: 0, no: 0 },
};

function rereadWeight(choice) {
  if (choice === "yes") return 1.5;
  if (choice === "no") return 0.55;
  return 1;
}

function isPercentField(key) {
  return String(key).includes("0-100%");
}

function fieldMax(key) {
  return isPercentField(key) ? 100 : 5;
}

function shortLabel(key) {
  return SHORT_LABELS[key] || String(key).replace(/\s*\(0-[^)]+\)\s*$/, "");
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedAvg(pairs) {
  let sum = 0;
  let w = 0;
  for (const [value, weight] of pairs) {
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    sum += value * weight;
    w += weight;
  }
  return w ? sum / w : null;
}

function countTags(reviews, key) {
  const counts = {};
  for (const review of reviews) {
    const tags = Array.isArray(review?.[key]) ? review[key] : [];
    for (const tag of tags) {
      const t = String(tag || "").trim();
      if (!t) continue;
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Aggreger Tines anmeldelser → learned-taste.json.
 * Ignorerede felter ("kan ikke huske") indgår aldrig.
 */
export function rebuildLearnedTaste(reviews = null) {
  const all = Array.isArray(reviews) ? reviews : readReviewsFromDisk();
  const scored = all.filter(
    (r) => typeof r?.overallScore === "number" && !Number.isNaN(r.overallScore),
  );

  const fieldBuckets = {};
  const reread = { yes: 0, maybe: 0, no: 0 };

  for (const review of scored) {
    const ignored = new Set(
      (review.ignoredFields || []).map((k) => String(k)),
    );
    const weight = rereadWeight(review.rereadChoice);
    if (review.rereadChoice === "yes") reread.yes += 1;
    else if (review.rereadChoice === "no") reread.no += 1;
    else if (review.rereadChoice === "maybe") reread.maybe += 1;

    const high = review.overallScore >= 70;
    const low = review.overallScore <= 45;

    for (const [key, entry] of Object.entries(review.subjectiveScores || {})) {
      if (ignored.has(key)) continue;
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.score !== "number" || Number.isNaN(entry.score)) continue;

      if (!fieldBuckets[key]) {
        fieldBuckets[key] = { all: [], high: [], low: [] };
      }
      fieldBuckets[key].all.push([entry.score, weight]);
      if (high) fieldBuckets[key].high.push([entry.score, weight]);
      if (low) fieldBuckets[key].low.push([entry.score, weight]);
    }
  }

  const fieldPrefs = {};
  for (const [key, bucket] of Object.entries(fieldBuckets)) {
    const mean = weightedAvg(bucket.all);
    const highMean = weightedAvg(bucket.high);
    const lowMean = weightedAvg(bucket.low);
    if (mean == null) continue;
    fieldPrefs[key] = {
      n: bucket.all.length,
      mean: Math.round(mean * 100) / 100,
      highMean:
        highMean == null ? null : Math.round(highMean * 100) / 100,
      lowMean: lowMean == null ? null : Math.round(lowMean * 100) / 100,
      highN: bucket.high.length,
      lowN: bucket.low.length,
      max: fieldMax(key),
    };
  }

  const learned = {
    version: "learned-taste-v1",
    reviewCount: all.length,
    scoredReviewCount: scored.length,
    updatedAt: new Date().toISOString(),
    fieldPrefs,
    positiveTags: countTags(scored, "positives"),
    negativeTags: countTags(scored, "negatives"),
    reread,
  };

  writeFileSync(LEARNED_PATH, JSON.stringify(learned, null, 2), "utf8");
  console.log(
    `[learned-taste] Opdateret fra ${scored.length} scorede anmeldelse(r)`,
  );
  return learned;
}

export function loadLearnedTaste() {
  if (!existsSync(LEARNED_PATH)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(LEARNED_PATH, "utf8"));
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

function strengthFromCount(scoredCount) {
  if (scoredCount < 5) return 0;
  return Math.min(1, scoredCount / 50);
}

function maxAbsDelta(strength) {
  return 3 + 5 * strength; // 3..8
}

/**
 * Justér Indholdsmatch ud fra learned-taste.
 * Returnerer altid et score; delta=0 hvis for lidt data / Excel-låst håndteres af caller.
 */
export function applyLearnedTasteAdjustment(row, baseScore) {
  const base = Number(baseScore);
  if (Number.isNaN(base)) {
    return { score: baseScore, delta: 0, reasons: [], strength: 0 };
  }

  const taste = loadLearnedTaste();
  const strength = strengthFromCount(taste.scoredReviewCount || 0);
  if (!strength) {
    return { score: Math.round(base), delta: 0, reasons: [], strength: 0 };
  }

  let raw = 0;
  const reasons = [];

  for (const [key, pref] of Object.entries(taste.fieldPrefs || {})) {
    if (!pref || pref.n < 3) continue;
    const seriesVal = Number(row?.[key]);
    if (Number.isNaN(seriesVal)) continue;

    const target = pref.highMean != null && pref.highN >= 2 ? pref.highMean : pref.mean;
    if (target == null) continue;

    const max = pref.max || fieldMax(key);
    const distance = Math.abs(seriesVal - target) / max;
    const alignment = 1 - Math.min(1, distance); // 1 = spot on
    const preferenceStrength = Math.abs(target - max / 2) / (max / 2); // 0..1
    if (preferenceStrength < 0.15) continue;

    const weight = getTineFieldWeight(key);
    const contrib = (alignment - 0.45) * 2.2 * weight * preferenceStrength;
    raw += contrib;

    if (alignment >= 0.72 && preferenceStrength >= 0.25) {
      reasons.push(
        `matcher din ${shortLabel(key)}-smag (≈${Math.round(target)}${max === 100 ? "%" : "/5"})`,
      );
    } else if (alignment <= 0.35 && preferenceStrength >= 0.3) {
      reasons.push(
        `afviger fra din ${shortLabel(key)}-smag (du ligger typisk ≈${Math.round(target)}${max === 100 ? "%" : "/5"})`,
      );
    }
  }

  // Tag-signal: bully
  const bullyNeg = taste.negativeTags?.["Bully / nedladende MMC"] || 0;
  if (bullyNeg >= 2) {
    const risk = String(row?.["Bully-risiko"] || "").toLowerCase();
    if (risk === "høj" || risk === "mellem") {
      raw -= 1.2 * Math.min(1, bullyNeg / 8);
      reasons.push("straffer bully-risiko (du markerer det ofte negativt)");
    }
  }

  const spiceNeg = taste.negativeTags?.["For meget erotik ift. plot"] || 0;
  if (spiceNeg >= 2) {
    const spice = Number(row?.["Spice/erotik (0-5)"]);
    const plot = Number(row?.["Episk plot (0-5)"]);
    if (!Number.isNaN(spice) && spice >= 4 && !Number.isNaN(plot) && plot <= 2.5) {
      raw -= 1.0 * Math.min(1, spiceNeg / 8);
      reasons.push("straffer høj spice ift. tyndt plot");
    }
  }

  const cap = maxAbsDelta(strength);
  const scaled = Math.max(-cap, Math.min(cap, raw * strength * 1.35));
  const delta = Math.round(scaled);
  const score = Math.max(0, Math.min(100, Math.round(base + delta)));

  const uniqueReasons = [...new Set(reasons)].slice(0, 3);
  return { score, delta, reasons: uniqueReasons, strength, reviewCount: taste.scoredReviewCount };
}

export function formatLearnedTasteReason(adjustment, baseReason = "") {
  if (!adjustment?.delta) {
    return baseReason || "";
  }
  const sign = adjustment.delta > 0 ? "+" : "";
  const why =
    adjustment.reasons?.length > 0
      ? adjustment.reasons.join("; ")
      : "baseret på dine anmeldelser";
  const line = `Anmeldelseslæring ${sign}${adjustment.delta}: ${why}.`;
  if (!baseReason) return line;
  return `${baseReason} ${line}`.trim();
}

export function getLearnedTasteStatus() {
  const taste = loadLearnedTaste();
  return {
    reviewCount: taste.reviewCount || 0,
    scoredReviewCount: taste.scoredReviewCount || 0,
    updatedAt: taste.updatedAt || null,
    fieldCount: Object.keys(taste.fieldPrefs || {}).length,
    active: strengthFromCount(taste.scoredReviewCount || 0) > 0,
  };
}

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const dataPath = join(root, "data/series.json");
const backupsDir = join(root, "data/backups");
import {
  sanitizeGoodreadsScore,
  isCatalogRatingDisguise,
  parseRatingNumber,
} from "./goodreads.js";

const MIGRATION_FLAG = "schemaVersion";
const CURRENT_SCHEMA = 3;

function looksLikeOpenLibraryOrGoogle(value) {
  return isCatalogRatingDisguise(value);
}

/**
 * Migrér én række sikkert. Bevarer Tines egne felter og alle scorer.
 */
export function migrateRow(row) {
  if (!row || typeof row !== "object") return row;
  const next = { ...row };

  if (!next._ratingMeta) next._ratingMeta = {};

  const gr = next["Goodreads-score"];
  if (gr != null && gr !== "" && gr !== "Ikke verificeret") {
    if (looksLikeOpenLibraryOrGoogle(gr)) {
      const n = parseRatingNumber(
        String(gr).replace(/\(.*?\)/g, "").trim()
      );
      // parseRatingNumber returns null for OL strings — extract number manually
      const rawNum = String(gr).match(/(\d+(?:\.\d+)?)/);
      const catalogNum = rawNum ? Number(rawNum[1]) : null;
      next._ratingMeta.catalog = {
        value: catalogNum ?? n,
        source: String(gr).toLowerCase().includes("google")
          ? "Google Books"
          : "Open Library",
        matchConfidence: "medium",
        fetchedAt: null,
        note: "Migreret fra gammel kolonne — ikke Goodreads",
      };
      next["Goodreads-score"] = null;
      next._ratingMeta.goodreads = null;
    } else if (!next._ratingMeta.goodreads && !next._ratingMeta.legacy) {
      const n = sanitizeGoodreadsScore(gr);
      next._ratingMeta.legacy = {
        value: n ?? gr,
        source: "legacy_unknown",
        matchConfidence: "low",
        fetchedAt: null,
      };
      next["Goodreads-score"] = n;
    } else {
      next["Goodreads-score"] = sanitizeGoodreadsScore(gr);
    }
  } else {
    next["Goodreads-score"] = null;
  }

  // Normalisér "Ikke verificeret" → null for fakta (UI viser teksten)
  const factKeys = [
    "Antal bøger i serien",
    "Lydbog (ja/nej, ikke hele serien)",
    "Er serien færdigskrevet",
  ];
  for (const key of factKeys) {
    if (next[key] === "Ikke verificeret") {
      // Behold legacy tekst i _factsRaw for sporbarhed, men UI kan mappe null
      if (!next._legacyFacts) next._legacyFacts = {};
      next._legacyFacts[key] = "Ikke verificeret";
    }
  }

  if (next["Tines score"] === "") next["Tines score"] = null;
  if (next["Tines egen vurdering"] === undefined) {
    next["Tines egen vurdering"] = null;
  }

  next[MIGRATION_FLAG] = CURRENT_SCHEMA;
  return next;
}

export function migrateSeriesList(list) {
  return (list || []).map(migrateRow);
}

/**
 * Backup + migrér series.json hvis nødvendigt. Returnerer om der blev skrevet.
 */
export function ensureMigratedDatabase() {
  if (!existsSync(dataPath)) return { migrated: false, count: 0 };

  const raw = readFileSync(dataPath, "utf8");
  const list = JSON.parse(raw || "[]");
  const needs =
    !Array.isArray(list) ||
    list.some((r) => r?.[MIGRATION_FLAG] !== CURRENT_SCHEMA);

  if (!needs) return { migrated: false, count: list.length };

  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupsDir, `series-pre-migrate-${stamp}.json`);
  copyFileSync(dataPath, backupPath);

  const migrated = migrateSeriesList(list);
  writeFileSync(dataPath, JSON.stringify(migrated, null, 2), "utf8");
  console.log(
    `Migrerede ${migrated.length} serier → schema v${CURRENT_SCHEMA} (backup: ${backupPath})`
  );
  return { migrated: true, count: migrated.length, backupPath };
}

export { CURRENT_SCHEMA, MIGRATION_FLAG };

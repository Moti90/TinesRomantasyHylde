import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { COLUMNS } from "./columns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_PATH = join(__dirname, "../../data/score-reference.json");

/** Felter der kommer fra Excel-referencen og ikke må overskrives af AI. */
export const REFERENCE_SCORE_KEYS = [
  "Tine-score",
  "Book hangover (0-5)",
  "Tempo",
  "Worldbuilding (0-5)",
  "Worldbuilding-tags",
  "Episk plot (0-5)",
  "Politiske intriger (0-5)",
  "Krig/militær (0-5)",
  "Chosen one eller vokser naturligt ind i rollen?",
  "Kvindelig udvikling (0-5)",
  "Karakterudvikling (0-5)",
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Bully-risiko",
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "FemDom (ja/nej)",
  "Hvor hurtigt griber den? (0-100%)",
  "Falder kvaliteten?",
  "Happy ending?",
  "Tilfredsstillende slutning?",
  "Trigger warnings",
  "Permanente dødsfald blandt hovedpersonerne?",
  "Romance sekundær eller central?",
  "Romance i fokus (0-100%)",
  "Minder mest om",
  "Hvis du savner...",
  "Rhysand-faktoren",
];

const NUMERIC_KEYS = new Set([
  "Tine-score",
  "Book hangover (0-5)",
  "Worldbuilding (0-5)",
  "Episk plot (0-5)",
  "Politiske intriger (0-5)",
  "Krig/militær (0-5)",
  "Kvindelig udvikling (0-5)",
  "Karakterudvikling (0-5)",
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "Rhysand-faktoren",
]);

function normalizePct(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : value;
}

function normalizeCell(key, value) {
  if (value == null || value === "") return null;
  if (NUMERIC_KEYS.has(key) || /0-100/.test(key)) {
    return normalizePct(value);
  }
  return value;
}

function seriesKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Læs Excel og byg score-reference map (serie → scorefelter).
 */
export function buildScoreReferenceFromExcel(filePath) {
  const data = readFileSync(filePath);
  const wb = XLSX.read(data, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames.includes("Hele TBR")
    ? "Hele TBR"
    : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: null,
    raw: false,
  });

  const bySerie = {};
  for (const raw of rows) {
    const name = raw["Seriens navn"];
    if (!name) continue;
    const entry = {
      "Seriens navn": name,
      Forfatter: raw.Forfatter ?? null,
      "Første bog/titel": raw["Første bog/titel"] ?? null,
      Status: raw.Status ?? null,
    };
    for (const key of REFERENCE_SCORE_KEYS) {
      if (!(key in raw) && !COLUMNS.includes(key)) continue;
      entry[key] = normalizeCell(key, raw[key]);
    }
    if (entry["Tine-score"] == null) continue;
    bySerie[seriesKey(name)] = entry;
  }

  return {
    sourceFile: filePath,
    importedAt: new Date().toISOString(),
    count: Object.keys(bySerie).length,
    bySerie,
  };
}

export function saveScoreReference(ref) {
  mkdirSync(dirname(REF_PATH), { recursive: true });
  writeFileSync(REF_PATH, JSON.stringify(ref, null, 2), "utf8");
  return REF_PATH;
}

export function loadScoreReference() {
  if (!existsSync(REF_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REF_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function getReferenceForSeries(seriesName) {
  const ref = loadScoreReference();
  if (!ref?.bySerie) return null;
  return ref.bySerie[seriesKey(seriesName)] || null;
}

/**
 * Påfør Excel-reference-scores på en række (overskriv vibe + Tine-score).
 */
export function applyReferenceScores(row, reference = null) {
  const ref =
    reference || getReferenceForSeries(row?.["Seriens navn"]);
  if (!ref) return row;
  const next = { ...row };
  for (const key of REFERENCE_SCORE_KEYS) {
    if (ref[key] !== undefined && ref[key] !== null && ref[key] !== "") {
      next[key] = ref[key];
    }
  }
  next._scoreReference = {
    locked: true,
    source: "excel",
    tineScore: ref["Tine-score"] ?? null,
  };
  return next;
}

/**
 * Kalibrerings-ankre direkte fra frozen Excel-reference.
 */
export function getReferenceAnchors(limit = 5) {
  const ref = loadScoreReference();
  if (!ref?.bySerie) return [];
  const rated = Object.values(ref.bySerie)
    .map((row) => {
      const score = Number(row["Tine-score"]);
      if (Number.isNaN(score)) return null;
      return {
        serie: row["Seriens navn"],
        forfatter: row.Forfatter || null,
        score,
        scoreSource: "excel_reference",
        note: null,
        "Rhysand-faktoren": row["Rhysand-faktoren"] ?? null,
        "Beskyttende helt(e) (0-5)": row["Beskyttende helt(e) (0-5)"] ?? null,
        "Bodyguard-vibe (0-5)": row["Bodyguard-vibe (0-5)"] ?? null,
        "Touch her and die-vibe (0-5)":
          row["Touch her and die-vibe (0-5)"] ?? null,
        "Episk plot (0-5)": row["Episk plot (0-5)"] ?? null,
        "Worldbuilding (0-5)": row["Worldbuilding (0-5)"] ?? null,
        "Karakterudvikling (0-5)": row["Karakterudvikling (0-5)"] ?? null,
        "Kvindelig udvikling (0-5)": row["Kvindelig udvikling (0-5)"] ?? null,
        "Spice/erotik (0-5)": row["Spice/erotik (0-5)"] ?? null,
        "Spice/erotik kvalitet (0-5)":
          row["Spice/erotik kvalitet (0-5)"] ?? null,
        "Romance i fokus (0-100%)": row["Romance i fokus (0-100%)"] ?? null,
        Tempo: row.Tempo ?? null,
        "Bully-risiko": row["Bully-risiko"] ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!rated.length) return [];
  const high = rated.slice(0, Math.ceil(limit / 2));
  const low = [...rated].reverse().slice(0, Math.floor(limit / 2));
  const seen = new Set();
  const mixed = [];
  for (const item of [...high, ...low]) {
    if (seen.has(item.serie)) continue;
    seen.add(item.serie);
    mixed.push(item);
  }
  return mixed.slice(0, limit);
}

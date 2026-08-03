import { loadSeries } from "./store.js";
import { getReferenceAnchors } from "./scoreReference.js";

function parseScore(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function pickField(row, key) {
  const v = row[key];
  if (v == null || v === "") return null;
  return v;
}

/**
 * Kalibrerings-ankre til LLM.
 * 1) Frozen Excel-reference (score-reference.json) — primær
 * 2) Ellers live DB (Tines score / Tine-score) som fallback
 */
export function getCalibrationAnchors(limit = 5) {
  const fromExcel = getReferenceAnchors(limit);
  if (fromExcel.length >= 2) return fromExcel;

  const rated = loadSeries()
    .map((row) => {
      const tineOwn = parseScore(row["Tines score"]);
      const tineHandbook = parseScore(row["Tine-score"]);
      const score = tineOwn ?? tineHandbook;
      if (score == null) return null;

      const hasVibe =
        pickField(row, "Beskyttende helt(e) (0-5)") != null ||
        pickField(row, "Rhysand-faktoren") != null ||
        pickField(row, "Episk plot (0-5)") != null ||
        pickField(row, "Spice/erotik (0-5)") != null ||
        pickField(row, "Bodyguard-vibe (0-5)") != null;

      if (!hasVibe && tineOwn == null) return null;

      return {
        serie: row["Seriens navn"],
        forfatter: row.Forfatter || null,
        score,
        scoreSource: tineOwn != null ? "tines_egen" : "db_fallback",
        note: row["Tines egen vurdering"] || null,
        "Rhysand-faktoren": pickField(row, "Rhysand-faktoren"),
        "Beskyttende helt(e) (0-5)": pickField(row, "Beskyttende helt(e) (0-5)"),
        "Bodyguard-vibe (0-5)": pickField(row, "Bodyguard-vibe (0-5)"),
        "Touch her and die-vibe (0-5)": pickField(
          row,
          "Touch her and die-vibe (0-5)"
        ),
        "Episk plot (0-5)": pickField(row, "Episk plot (0-5)"),
        "Worldbuilding (0-5)": pickField(row, "Worldbuilding (0-5)"),
        "Karakterudvikling (0-5)": pickField(row, "Karakterudvikling (0-5)"),
        "Kvindelig udvikling (0-5)": pickField(row, "Kvindelig udvikling (0-5)"),
        "Spice/erotik (0-5)": pickField(row, "Spice/erotik (0-5)"),
        "Spice/erotik kvalitet (0-5)": pickField(
          row,
          "Spice/erotik kvalitet (0-5)"
        ),
        "Romance i fokus (0-100%)": pickField(row, "Romance i fokus (0-100%)"),
        Tempo: pickField(row, "Tempo"),
        "Bully-risiko": pickField(row, "Bully-risiko"),
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

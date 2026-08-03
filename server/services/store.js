import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { sortSeries } from "./columns.js";
import { migrateSeriesList } from "./migrate.js";
import { sanitizeGoodreadsScore } from "./goodreads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "../../data/series.json");

export function loadSeries() {
  if (!existsSync(dataPath)) {
    writeFileSync(dataPath, "[]", "utf8");
    return [];
  }
  const raw = readFileSync(dataPath, "utf8");
  const list = migrateSeriesList(JSON.parse(raw || "[]"));
  return sortSeries(list);
}

export function saveSeries(list) {
  const cleaned = sortSeries(list).map((row) => ({
    ...row,
    "Goodreads-score": sanitizeGoodreadsScore(row["Goodreads-score"]),
  }));
  if (existsSync(dataPath)) {
    copyFileSync(dataPath, `${dataPath}.bak`);
  }
  writeFileSync(dataPath, JSON.stringify(cleaned, null, 2), "utf8");
  return cleaned;
}

export function upsertSeries(row) {
  const list = loadSeries();
  const key = (row["Seriens navn"] || "").trim().toLowerCase();
  const idx = list.findIndex(
    (r) => (r["Seriens navn"] || "").trim().toLowerCase() === key
  );
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...row,
      // Tines egne felter overskrives aldrig af AI/null
      "Tines egen vurdering":
        row["Tines egen vurdering"] != null && row["Tines egen vurdering"] !== ""
          ? row["Tines egen vurdering"]
          : prev["Tines egen vurdering"] ?? null,
      "Tines score":
        row["Tines score"] != null && row["Tines score"] !== ""
          ? row["Tines score"]
          : prev["Tines score"] ?? null,
      Status: row.Status || prev.Status || "Ikke læst",
    };
  } else {
    list.push(row);
  }
  return saveSeries(list);
}

export function patchSeries(seriesName, patch) {
  const list = loadSeries();
  const key = seriesName.trim().toLowerCase();
  const idx = list.findIndex(
    (r) => (r["Seriens navn"] || "").trim().toLowerCase() === key
  );
  if (idx < 0) throw new Error("Serie ikke fundet");
  list[idx] = { ...list[idx], ...patch };
  return saveSeries(list);
}

export function deleteSeries(seriesName) {
  const list = loadSeries();
  const key = seriesName.trim().toLowerCase();
  const next = list.filter(
    (r) => (r["Seriens navn"] || "").trim().toLowerCase() !== key
  );
  if (next.length === list.length) throw new Error("Serie ikke fundet");
  return saveSeries(next);
}

export function getDataPath() {
  return dataPath;
}

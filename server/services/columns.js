import { readFileSync } from "fs";
import { dataPath } from "./paths.js";

export const COLUMNS = JSON.parse(readFileSync(dataPath("columns.json"), "utf8"));

export const STATUS_ORDER = [
  "Læser nu",
  "Ikke læst",
  "Sat på pause",
  "Læst",
  "Droppet",
];

export function emptySeries(overrides = {}) {
  const row = Object.fromEntries(COLUMNS.map((c) => [c, null]));
  row.Status = "Ikke læst";
  return { ...row, ...overrides };
}

export function sortSeries(list) {
  return [...list].sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.Status ?? "");
    const sb = STATUS_ORDER.indexOf(b.Status ?? "");
    const oa = sa === -1 ? 99 : sa;
    const ob = sb === -1 ? 99 : sb;
    if (oa !== ob) return oa - ob;
    const scoreA =
      a["Læseprioritet nu"] ?? a.Indholdsmatch ?? a["Tine-score"] ?? 0;
    const scoreB =
      b["Læseprioritet nu"] ?? b.Indholdsmatch ?? b["Tine-score"] ?? 0;
    return Number(scoreB) - Number(scoreA);
  });
}

export function parseTineScore(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

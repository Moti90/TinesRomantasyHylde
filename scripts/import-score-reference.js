/**
 * Importer Excel-reference-scores:
 * 1) Gem frozen score-reference.json
 * 2) Påfør scores på matching serier i series.json (bevar research/meta)
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  buildScoreReferenceFromExcel,
  saveScoreReference,
  applyReferenceScores,
} from "../server/services/scoreReference.js";
import { loadSeries, saveSeries } from "../server/services/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const excelPath =
  process.argv[2] ||
  "C:\\Users\\45313\\Downloads\\updated_master(2)_renset (1).xlsx";

const ref = buildScoreReferenceFromExcel(excelPath);
const out = saveScoreReference(ref);
console.log(`Score-reference: ${ref.count} serier → ${out}`);

const series = loadSeries();
let updated = 0;
const next = series.map((row) => {
  const name = row["Seriens navn"];
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const entry = ref.bySerie[key];
  if (!entry) return row;
  updated += 1;
  const merged = applyReferenceScores(row, entry);
  console.log(
    `  ${name}: Tine-score ${row["Tine-score"]} → ${merged["Tine-score"]} (beskyttende ${merged["Beskyttende helt(e) (0-5)"]}, THAD ${merged["Touch her and die-vibe (0-5)"]})`
  );
  return merged;
});

saveSeries(next);
console.log(`Opdaterede ${updated}/${series.length} serier i databasen.`);

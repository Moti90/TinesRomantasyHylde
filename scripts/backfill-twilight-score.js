import { loadSeries, saveSeries } from "../server/services/store.js";

const keys = [
  ["Episk plot (0-5)", 1.3],
  ["Worldbuilding (0-5)", 1.1],
  ["Kvindelig udvikling (0-5)", 1.2],
  ["Karakterudvikling (0-5)", 1.2],
  ["Beskyttende helt(e) (0-5)", 1.15],
  ["Bodyguard-vibe (0-5)", 1.15],
  ["Touch her and die-vibe (0-5)", 1.2],
  ["Rhysand-faktoren", 1.25],
  ["Book hangover (0-5)", 1.0],
  ["Spice/erotik kvalitet (0-5)", 0.7],
];

const list = loadSeries();
const i = list.findIndex((r) => (r["Seriens navn"] || "").includes("Twilight"));
if (i < 0) {
  console.log("Twilight ikke fundet");
  process.exit(0);
}

const row = list[i];
let sum = 0;
let w = 0;
for (const [k, wt] of keys) {
  const n = Number(row[k]);
  if (Number.isNaN(n)) continue;
  sum += Math.max(0, Math.min(5, n)) * wt;
  w += wt;
}
const score = w ? Math.round(58 + (sum / w / 5) * 40) : 75;
row["Tine-score"] = score;
list[i] = row;
saveSeries(list);
console.log("Twilight Tine-score sat til", score);

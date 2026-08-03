import { reanalyzeSeries } from "../server/services/pipeline.js";

const name = "Harry Potter";
console.log("Genanalyserer", name, "…");
const result = await reanalyzeSeries(name, { forceAnalysis: true });
const row = result.row;
const keys = [
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
  "Tine-score",
  "Goodreads-score",
];
for (const k of keys) console.log(k, "=>", row[k]);
console.log("userMessage:", result.meta?.userMessage);

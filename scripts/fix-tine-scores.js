import { readFileSync } from "fs";
import { estimateTineScoreFromVibes } from "../server/services/handbookAnalysis.js";
import { reanalyzeSeries } from "../server/services/pipeline.js";

const s = JSON.parse(readFileSync("data/series.json", "utf8"));
for (const name of ["Harry Potter", "The Empyrean"]) {
  const row = s.find((x) => x["Seriens navn"] === name);
  console.log("\nBEFORE", name, "Tine", row?.["Tine-score"], "vibes-est", estimateTineScoreFromVibes(row));
  console.log({
    epic: row?.["Episk plot (0-5)"],
    wb: row?.["Worldbuilding (0-5)"],
    body: row?.["Bodyguard-vibe (0-5)"],
    thad: row?.["Touch her and die-vibe (0-5)"],
    rhys: row?.["Rhysand-faktoren"],
    spiceQ: row?.["Spice/erotik kvalitet (0-5)"],
    romance: row?.["Romance i fokus (0-100%)"],
  });
}

for (const name of ["Harry Potter", "The Empyrean"]) {
  console.log("\nReanalyze", name);
  const result = await reanalyzeSeries(name, { forceAnalysis: true });
  const row = result.row;
  console.log("AFTER Tine", row["Tine-score"]);
  console.log({
    epic: row["Episk plot (0-5)"],
    wb: row["Worldbuilding (0-5)"],
    body: row["Bodyguard-vibe (0-5)"],
    thad: row["Touch her and die-vibe (0-5)"],
    rhys: row["Rhysand-faktoren"],
    spiceQ: row["Spice/erotik kvalitet (0-5)"],
    spice: row["Spice/erotik (0-5)"],
    romance: row["Romance i fokus (0-100%)"],
    reason: row._analysisMeta?.assessments?.["Tine-score"]?.reason,
  });
}

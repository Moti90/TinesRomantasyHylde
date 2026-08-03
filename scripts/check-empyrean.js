import { readFileSync } from "fs";
import { estimateTineScoreFromVibes } from "../server/services/handbookAnalysis.js";

const s = JSON.parse(readFileSync("data/series.json", "utf8"));
const row = s.find((x) => x["Seriens navn"] === "The Empyrean");
console.log("Tine-score:", row?.["Tine-score"]);
console.log("vibes-est:", estimateTineScoreFromVibes(row));
console.log("reason:", row?._analysisMeta?.assessments?.["Tine-score"]?.reason);
console.log("AI predicted blend info:", row?._analysisMeta?.assessments?.["Tine-score"]);
console.log({
  epic: row?.["Episk plot (0-5)"],
  wb: row?.["Worldbuilding (0-5)"],
  female: row?.["Kvindelig udvikling (0-5)"],
  char: row?.["Karakterudvikling (0-5)"],
  prot: row?.["Beskyttende helt(e) (0-5)"],
  body: row?.["Bodyguard-vibe (0-5)"],
  thad: row?.["Touch her and die-vibe (0-5)"],
  rhys: row?.["Rhysand-faktoren"],
  hang: row?.["Book hangover (0-5)"],
  spiceQ: row?.["Spice/erotik kvalitet (0-5)"],
  spice: row?.["Spice/erotik (0-5)"],
  romance: row?.["Romance i fokus (0-100%)"],
  pol: row?.["Politiske intriger (0-5)"],
  war: row?.["Krig/militær (0-5)"],
});
console.log("webSearchUsed:", row?._analysisMeta?.webSearchUsed);
console.log("researchedAt:", row?._research?.researchedAt);

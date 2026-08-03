import { readFileSync } from "fs";
const s = JSON.parse(readFileSync("data/series.json", "utf8"));
const hp = s.find((x) => x["Seriens navn"] === "Harry Potter");

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
];

console.log("=== Flat scores ===");
for (const k of keys) console.log(k, "=>", hp[k]);

console.log("\n=== Assessment keys from AI ===");
const a = hp._analysisMeta?.assessments || {};
console.log(Object.keys(a));
for (const [k, v] of Object.entries(a)) {
  console.log(k, JSON.stringify(v));
}

console.log("\n=== Research summary ===");
const r = hp._research;
console.log("sources", r?.sources?.length);
console.log("consensus keys", Object.keys(r?.reviewConsensus || {}));
console.log("identity", r?.identity);
console.log("partial", r?.meta?.partial);
console.log("warnings", r?.meta?.warnings);

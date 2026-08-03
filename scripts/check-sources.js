import { readFileSync } from "fs";

const s = JSON.parse(readFileSync("data/series.json", "utf8"));
const row = s.find((x) => Number(x["Goodreads-score"]) === 4.36)
  || s.find((x) => x["Seriens navn"] === "The Empyrean");

console.log("Serie:", row?.["Seriens navn"]);
console.log("foundation:", JSON.stringify(row?._analysisMeta?.foundation, null, 2));
console.log("\nAlle kilder:");
for (const src of row?._research?.sources || []) {
  console.log(`- [${src.type}] ${src.title} | ${src.url}`);
}
console.log("\nwebSearchCalls:", row?._research?.meta?.webSearchCalls);
console.log("sourceCount meta:", row?._research?.meta?.sourceCount);
console.log("consensus keys:", Object.keys(row?._research?.reviewConsensus || {}));

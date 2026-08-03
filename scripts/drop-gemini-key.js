import { readFileSync, writeFileSync } from "fs";

const p = "data/config.json";
const c = JSON.parse(readFileSync(p, "utf8"));
delete c.geminiApiKey;
writeFileSync(p, JSON.stringify(c, null, 2));
console.log("Config keys:", Object.keys(c).join(", ") || "(tom)");

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { sortSeries } from "../services/columns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src =
  process.argv[2] ||
  "C:\\Users\\45313\\Downloads\\_tine_excel_parse.json";
const dest = join(__dirname, "../../data/series.json");

if (!existsSync(src)) {
  console.error("JSON ikke fundet:", src);
  process.exit(1);
}

const data = JSON.parse(readFileSync(src, "utf8"));
const list = sortSeries(data["Hele TBR"] || data.series || []);
writeFileSync(dest, JSON.stringify(list, null, 2), "utf8");
console.log(`Skrev ${list.length} serier til data/series.json`);

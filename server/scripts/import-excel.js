import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { workbookToSeries } from "../services/excel.js";
import { saveSeries } from "../services/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath =
  process.argv[2] ||
  "C:\\Users\\45313\\Downloads\\updated_master(2)_renset.xlsx";

async function main() {
  if (!existsSync(defaultPath)) {
    console.error("Fil ikke fundet:", defaultPath);
    process.exit(1);
  }
  const buffer = readFileSync(defaultPath);
  const list = await workbookToSeries(buffer);
  saveSeries(list);
  console.log(`Importerede ${list.length} serier fra ${defaultPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

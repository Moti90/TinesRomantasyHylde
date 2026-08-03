import { ensureMigratedDatabase } from "../server/services/migrate.js";
import { loadSeries, saveSeries } from "../server/services/store.js";

const result = ensureMigratedDatabase();
console.log("migrate:", result);

// Force rewrite so OL-strenge renses via saveSeries sanitize
const series = loadSeries();
saveSeries(series);

const hp = series.find((x) =>
  String(x["Seriens navn"] || "").includes("Harry")
);
console.log(
  "HP Goodreads:",
  hp?.["Goodreads-score"],
  "catalog:",
  hp?._ratingMeta?.catalog
);

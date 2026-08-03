import { readFileSync } from "fs";
const s = JSON.parse(readFileSync("data/series.json", "utf8"));
const hp = s.find((x) => x["Seriens navn"] === "Harry Potter");
console.log("Goodreads:", hp?.["Goodreads-score"]);
console.log(
  "foundation goodreads:",
  JSON.stringify(hp?._analysisMeta?.foundation?.goodreads, null, 2)
);

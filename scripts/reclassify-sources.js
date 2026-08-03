/**
 * Genberegn foundation-tal fra gemte kilder (uden ny API-kald).
 */
import { readFileSync, writeFileSync } from "fs";
import { summarizeSourceFoundation } from "../server/services/webResearch.js";

function classify(url, title, declared) {
  const u = String(url || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  const d = String(declared || "").toLowerCase();
  if (u.includes("wikipedia.org") || t.includes("wikipedia")) return "wikipedia";
  if (u.includes("goodreads.com")) {
    if (
      u.includes("/review/") ||
      t.includes("discussion") ||
      t.includes("thread")
    ) {
      return "forum";
    }
    return "goodreads";
  }
  if (u.includes("reddit.com") || d === "forum") return "forum";
  if (
    d === "blog" ||
    /review|anmeld|book blog|guide/i.test(t) ||
    /novel|book|series/i.test(u)
  ) {
    if (
      !u.includes("amazon.") &&
      !u.includes("books.google") &&
      !u.includes("wikipedia")
    ) {
      return "blog";
    }
  }
  if (
    [
      "blog",
      "forum",
      "wikipedia",
      "goodreads",
      "official",
      "publisher",
      "catalog",
      "other",
    ].includes(d)
  ) {
    return d;
  }
  return d || "other";
}

const path = "data/series.json";
const list = JSON.parse(readFileSync(path, "utf8"));
let n = 0;

for (const row of list) {
  if (!row._research?.sources || !row._analysisMeta) continue;
  row._research.sources = row._research.sources.map((s) => ({
    ...s,
    type: classify(s.url, s.title, s.type),
  }));
  const counts = summarizeSourceFoundation(row._research.sources);
  row._analysisMeta.foundation = {
    ...row._analysisMeta.foundation,
    ...counts,
  };
  row._analysisMeta.sources = row._research.sources.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    type: s.type,
  }));
  n += 1;
}

writeFileSync(path, JSON.stringify(list, null, 2), "utf8");
console.log("Opdaterede foundation for", n, "serier");

const emp = list.find((r) => r["Seriens navn"] === "The Empyrean");
console.log("Empyrean foundation:", emp?._analysisMeta?.foundation);
console.log(
  "Empyrean types:",
  emp?._research?.sources?.map((s) => `${s.type}: ${s.title}`)
);

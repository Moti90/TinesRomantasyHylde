import OpenAI from "openai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { getOpenAIKey, hasOpenAIKey } from "./config.js";
import { dataPath } from "./paths.js";
import { DISCOVERY_MODEL } from "./versions.js";
import {
  normalizeReviewSummary,
  reviewSummaryKey,
  REVIEW_SUMMARY_VERSION,
} from "./tineReviewSummaryUtils.js";

const CACHE_FILE = dataPath("tine-review-summaries.json");

function readCache() {
  if (!existsSync(CACHE_FILE)) return { summaries: {} };
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    return {
      summaries:
        parsed.summaries && typeof parsed.summaries === "object"
          ? parsed.summaries
          : {},
    };
  } catch {
    return { summaries: {} };
  }
}

function saveCache(data) {
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({ summaries: data.summaries || {} }, null, 2),
    "utf8"
  );
}

function outputText(response) {
  if (response?.output_text) return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Resuméet havde forkert format");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function getTineReviewSummary(book, { force = false } = {}) {
  const title = String(book?.firstBookTitle || book?.displayTitle || "").trim();
  const author = String(book?.author || "").trim();
  if (!title) throw new Error("Bogen mangler titel");

  const key = reviewSummaryKey(book);
  const cache = readCache();
  if (!force && cache.summaries[key]?.summary) {
    return { ...cache.summaries[key], cached: true };
  }
  if (!hasOpenAIKey()) {
    throw new Error("AI skal være sat op for at lave et bogresumé");
  }

  const prompt = `Lav en kort dansk hukommelseshjælp til en læser, der allerede har læst denne konkrete bog.

BOG: ${title}
FORFATTER: ${author || "Ukendt"}
SERIE: ${book?.seriesName || "Ukendt"}
GOODREADS-LINK: ${book?.goodreadsUrl || "Ikke oplyst"}

Returnér KUN JSON:
{
  "shortSummary": "3-5 korte, spoilerfrie sætninger om hovedpersoner, udgangspunkt og central konflikt",
  "spoilerPoints": [
    "3-6 konkrete huskepunkter om vigtige hændelser, relationer og bogens slutning"
  ],
  "note": "Kun hvis bogidentiteten eller oplysningerne er usikre; ellers null"
}

Krav:
- Resuméet skal handle om den præcise bog, ikke bare hele serien.
- Brug websøgning til at kontrollere titel og forfatter.
- Opdig ikke detaljer. Ved usikkerhed skal det stå i note.
- shortSummary må ikke afsløre slutningen.
- spoilerPoints må gerne afsløre hele handlingen, fordi læseren allerede har læst bogen.
- Skriv enkelt og naturligt dansk.`;

  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const response = await client.responses.create({
    model: DISCOVERY_MODEL,
    temperature: 0.1,
    tools: [{ type: "web_search" }],
    input: [
      {
        role: "system",
        content:
          "Du laver præcise, korte bogresuméer på dansk. Du skelner altid mellem spoilerfri tekst og tydeligt markerede spoilers.",
      },
      { role: "user", content: prompt },
    ],
  });
  const summary = normalizeReviewSummary(extractJson(outputText(response)));
  const payload = {
    summary,
    generatedAt: new Date().toISOString(),
    model: response.model || DISCOVERY_MODEL,
    version: REVIEW_SUMMARY_VERSION,
  };
  cache.summaries[key] = payload;
  saveCache(cache);
  return { ...payload, cached: false };
}

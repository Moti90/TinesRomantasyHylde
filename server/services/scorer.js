import { readFileSync } from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { COLUMNS, emptySeries } from "./columns.js";
import {
  getGeminiKey,
  getOpenAIKey,
  getAiProvider,
  hasGeminiKey,
  hasOpenAIKey,
} from "./config.js";
import { getCalibrationAnchors } from "./calibration.js";
import { dataPath } from "./paths.js";

export { hasGeminiKey, hasOpenAIKey };

const handbook = readFileSync(dataPath("handbook.md"), "utf8");

const OPENAI_MODEL = "gpt-4o-mini";
const GEMINI_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ingen JSON i modelsvar");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function isRateLimitError(err) {
  const msg = String(err?.message || err || "");
  const status = err?.status || err?.statusCode;
  return (
    status === 429 ||
    msg.includes("429") ||
    /too many requests|resource exhausted|quota|rate limit|insufficient_quota|spend_limit/i.test(
      msg
    )
  );
}

/** Fast seed pr. serie → samme bog giver samme model-output (best effort). */
function seedFromText(text) {
  const s = String(text || "")
    .trim()
    .toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildPrompt({ query, research, mofibo, link }) {
  const anchors = getCalibrationAnchors(8);
  const calibrationBlock =
    anchors.length > 0
      ? `
KALIBRERING FRA REFERENCE (vigtigt):
Følgende serier er allerede scoret (Excel/håndbog eller Tines egne tal).
scoreSource "tines_egen" vejer tungest; "excel_reference" er database-reference.
Brug dem til at ramme samme skala for Tine-score og tropes.
Hvis en ny serie minder om høje ankre → højere scores.
Hvis den minder om lave ankre → lavere scores.
Håndbogen gælder stadig felt for felt — ankrene kalibrerer niveauet.
${JSON.stringify(anchors, null, 2)}
`
      : `
KALIBRERING:
Ingen reference-scores fundet endnu. Brug kun håndbogen.
`;

  return `Du udfylder én række i Tines Romantasy Liste efter HÅNDBOGEN.

"Ingen gæt" gælder FAKTA — ikke at du skal lade alle scorer være tomme.

A) FAKTA (kun verificeret):
   Antal bøger, Lydbog, Mofibo, færdigskrevet, Goodreads.
   Kun fra RESEARCH/MOFIBO. Ellers præcis "Ikke verificeret". Opfind ikke katalog-tal.

B) HÅNDBOGS-VURDERING (det er meningen med appen — udfyld når serien er identificeret):
   Alle 0–5 felter, %, tempo, Relation, bully, romance, chosen one, worldbuilding-tags,
   trigger warnings, slutning/dødsfald/kvalitetsfald, "Minder mest om", "Hvis du savner...", Tine-score.
   Brug research (inkl. Wikipedia-uddrag hvis findes) + din viden om serien.
   Relation = MF / RH / MM / FF / Menage o.l. — OBLIGATORISK når serien er kendt (Twilight = MF).
   Katalog-API'er har næsten aldrig Relation; det er OK at sætte den fra seriekendskab.
   Tomme scorer / "Ikke verificeret" overalt er FORKERT når titel+forfatter er kendt.
   0 betyder "fraværende", ikke "ved ikke".

C) Kun Tine selv: "Tines score" og "Tines egen vurdering" = null.

Deterministisk: samme serie → samme scorer.

HÅNDBOG:
${handbook}

${calibrationBlock}

RESEARCH:
${JSON.stringify(research, null, 2)}

MOFIBO-TJEK: ${JSON.stringify(mofibo)}
BRUGER-QUERY: ${query}
LINK (hvis givet): ${link || "ingen"}

- Bodyguard ≠ Beskyttende. THAD kun højt hvis ikonisk.
- 0–5: hele tal efter håndbogen.
- Tine-score: 0–100 helhedstal (ikke gennemsnit), obligatorisk når vibe-scorer udfyldes.
- Status: "Ikke læst" medmindre andet er oplagt.
- Returnér KUN ét JSON-objekt med præcis disse nøgler:
${JSON.stringify(COLUMNS)}
`;
}

const UNVERIFIED = "Ikke verificeret";

/** Kun katalog-fakta vi ikke har API til — overskriv model-gæt. */
const OBJECTIVE_FORCE_UNVERIFIED = [
  "Antal bøger i serien",
  "Lydbog (ja/nej, ikke hele serien)",
  "Er serien færdigskrevet",
];

function applyHandbookGuards(row, research, mofibo) {
  row["Er serien på Mofibo? (ja, nej, ikke hele serien)"] =
    mofibo?.status || UNVERIFIED;
  // Goodreads må ALDRIG udfyldes fra Open Library / Google Books
  row["Goodreads-score"] = null;

  for (const key of OBJECTIVE_FORCE_UNVERIFIED) {
    row[key] = UNVERIFIED;
  }

  return row;
}

function parseScoreValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && !Number.isNaN(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Math.max(0, Math.min(100, Math.round(Number(m[1]))));
}

/** Fallback hvis modellen glemmer Tine-score (forveksler med "Tines score"). */
function estimateTineScore(row) {
  const keys = [
    ["Episk plot (0-5)", 1.3],
    ["Worldbuilding (0-5)", 1.1],
    ["Kvindelig udvikling (0-5)", 1.2],
    ["Karakterudvikling (0-5)", 1.2],
    ["Beskyttende helt(e) (0-5)", 1.15],
    ["Bodyguard-vibe (0-5)", 1.15],
    ["Touch her and die-vibe (0-5)", 1.2],
    ["Rhysand-faktoren", 1.25],
    ["Book hangover (0-5)", 1.0],
    ["Spice/erotik kvalitet (0-5)", 0.7],
  ];
  let sum = 0;
  let weight = 0;
  let nonzero = 0;
  for (const [key, w] of keys) {
    const n = Number(row[key]);
    if (Number.isNaN(n)) continue;
    sum += Math.max(0, Math.min(5, n)) * w;
    weight += w;
    if (n > 0) nonzero += 1;
  }
  // Tomme/nul-rækker → ikke opfind en kunstig lav score
  if (!weight || nonzero === 0) return null;
  const avg = sum / weight; // 0–5
  return Math.round(58 + (avg / 5) * 40); // ca. 58–98
}

function finalizeRow(parsed, { query, research, mofibo }, modelName) {
  const row = emptySeries();
  for (const col of COLUMNS) {
    if (parsed[col] !== undefined) row[col] = parsed[col];
  }
  if (!row["Seriens navn"]) {
    row["Seriens navn"] = research.title || query;
  }
  if (!row["Første bog/titel"]) {
    row["Første bog/titel"] = research.title || query;
  }
  if (!row.Forfatter && research.authors?.length) {
    row.Forfatter = research.authors.join(", ");
  }

  applyHandbookGuards(row, research, mofibo);

  // Modellen forveksler ofte "Tine-score" med "Tines score"
  let tine = parseScoreValue(row["Tine-score"]);
  if (tine == null) {
    tine = parseScoreValue(
      parsed["Tine score"] ?? parsed["tine-score"] ?? parsed.TineScore
    );
  }
  // Kun estimér Tine-score hvis der findes rigtige vibe-scorer (ikke tom gæt-række)
  if (tine == null) {
    const hasVibes = [
      "Episk plot (0-5)",
      "Rhysand-faktoren",
      "Beskyttende helt(e) (0-5)",
    ].some((k) => {
      const n = Number(row[k]);
      return !Number.isNaN(n);
    });
    row["Tine-score"] = hasVibes ? estimateTineScore(row) : null;
  } else {
    row["Tine-score"] = tine;
  }

  row["Tines egen vurdering"] = null;
  row["Tines score"] = null;
  if (!row.Status) row.Status = "Ikke læst";
  row._model = modelName;
  return row;
}

/**
 * Scorer en serie. Returnerer { row, meta }.
 * Foretrækker OpenAI, ellers Gemini, ellers basis-fallback.
 */
export async function scoreSeries({ query, research, mofibo, link }) {
  const provider = getAiProvider();

  if (!provider) {
    const row = scoreFallback({ query, research, mofibo });
    return {
      row,
      meta: {
        fallback: true,
        reason: "no_key",
        provider: null,
        note: "Ingen AI-nøgle — kun basis-score. Tilføj OpenAI-nøgle i data/config.json.",
      },
    };
  }

  try {
    const row =
      provider === "openai"
        ? await scoreWithOpenAI({ query, research, mofibo, link })
        : await scoreWithGeminiRetry({ query, research, mofibo, link });
    return {
      row,
      meta: {
        fallback: false,
        reason: null,
        note: null,
        provider,
        model: row._model || null,
      },
    };
  } catch (err) {
    console.warn("AI-fejl, falder tilbage til basis-score:", err.message);
    const row = scoreFallback({ query, research, mofibo });
    const rateLimited = isRateLimitError(err);
    return {
      row,
      meta: {
        fallback: true,
        reason: rateLimited ? "rate_limit" : "ai_error",
        provider,
        note: rateLimited
          ? `${provider === "openai" ? "OpenAI" : "Gemini"} er begrænset (quota/limit). Tjek spend-limit/kredit, og brug Genanalysér senere.`
          : `AI fejlede (${err.message}). Basis-score brugt i stedet.`,
      },
    };
  }
}

async function scoreWithOpenAI({ query, research, mofibo, link }) {
  const key = getOpenAIKey();
  const prompt = buildPrompt({ query, research, mofibo, link });
  const seed = seedFromText(
    research?.title || query || research?.authors?.join(",") || "serie"
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      top_p: 1,
      seed,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Du er en deterministisk scoring-motor for Tines romantasy-liste. Samme input → samme JSON. Ingen kreativ variation. Svar kun med ét gyldigt JSON-objekt.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.code ||
      `OpenAI HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Tomt svar fra OpenAI");
  const parsed = extractJson(text);
  const modelUsed = data?.model || OPENAI_MODEL;
  console.log(
    `OpenAI: scorede med ${modelUsed} (seed=${seed}, system_fingerprint=${data.system_fingerprint || "?"})`
  );
  return finalizeRow(parsed, { query, research, mofibo }, modelUsed);
}

async function scoreWithGeminiRetry(args) {
  let lastErr;
  for (let round = 0; round < 2; round++) {
    try {
      return await scoreWithGemini(args);
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;
      if (round === 0) {
        console.warn("Gemini: venter 12s…");
        await sleep(12000);
      }
    }
  }
  throw lastErr;
}

async function scoreWithGemini({ query, research, mofibo, link }) {
  const genAI = new GoogleGenerativeAI(getGeminiKey());
  let lastErr;
  const prompt = buildPrompt({ query, research, mofibo, link });

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(`Gemini: prøver ${modelName}…`);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0 },
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = extractJson(text);
      return finalizeRow(parsed, { query, research, mofibo }, modelName);
    } catch (err) {
      lastErr = err;
      console.warn(`Model ${modelName} fejlede:`, String(err.message).slice(0, 180));
    }
  }
  throw lastErr;
}

function scoreFallback({ query, research, mofibo }) {
  const title = research.title || query;
  const authors = research.authors?.join(", ") || "Ikke verificeret";
  const tags =
    (research.subjects || []).slice(0, 6).join("; ") || "Ikke verificeret";
  const desc = (research.description || "").toLowerCase();

  const hasWar = /war|krig|military|battle|army/.test(desc);
  const hasPolitics = /politic|court|intrigue|hof|kongerige|empire/.test(desc);
  const hasRomance = /romance|love|lover|romant/.test(
    desc + tags.toLowerCase()
  );

  return emptySeries({
    Status: "Ikke læst",
    "Seriens navn": title,
    "Første bog/titel": title,
    Forfatter: authors,
    "Antal bøger i serien": "Ikke verificeret",
    "Lydbog (ja/nej, ikke hele serien)": "Ikke verificeret",
    "Er serien på Mofibo? (ja, nej, ikke hele serien)": mofibo.status,
    "Er serien færdigskrevet": "Ikke verificeret",
    Relation: "Ikke verificeret",
    "Tine-score": hasRomance ? 82 : 75,
    "Goodreads-score": null,
    "Book hangover (0-5)": 3,
    Tempo: "Moderat",
    "Worldbuilding (0-5)": 3,
    "Worldbuilding-tags": tags,
    "Episk plot (0-5)": hasWar || hasPolitics ? 4 : 3,
    "Politiske intriger (0-5)": hasPolitics ? 4 : 2,
    "Krig/militær (0-5)": hasWar ? 4 : 2,
    "Chosen one eller vokser naturligt ind i rollen?": "Ikke verificeret",
    "Kvindelig udvikling (0-5)": 3,
    "Karakterudvikling (0-5)": 3,
    "Beskyttende helt(e) (0-5)": 3,
    "Bodyguard-vibe (0-5)": 2,
    "Touch her and die-vibe (0-5)": 2,
    "Bully-risiko": "Ikke verificeret",
    "Spice/erotik (0-5)": "Ikke verificeret",
    "Spice/erotik kvalitet (0-5)": "Ikke verificeret",
    "FemDom (ja/nej)": "Ikke verificeret",
    "Hvor hurtigt griber den? (0-100%)": "Ikke verificeret",
    "Falder kvaliteten?": "Ikke verificeret",
    "Happy ending?": "Ikke verificeret",
    "Tilfredsstillende slutning?": "Ikke verificeret",
    "Trigger warnings": "Ikke verificeret",
    "Permanente dødsfald blandt hovedpersonerne?": "Ikke verificeret",
    "Romance sekundær eller central?": hasRomance
      ? "Central"
      : "Ikke verificeret",
    "Romance i fokus (0-100%)": hasRomance ? "40%" : "Ikke verificeret",
    "Minder mest om": "Ikke verificeret",
    "Hvis du savner...": "Ikke verificeret",
    "Rhysand-faktoren": 3,
    "Tines score": null,
    "Tines egen vurdering": null,
  });
}

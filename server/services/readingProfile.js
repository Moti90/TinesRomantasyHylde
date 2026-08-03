/**
 * Læseprofil ud fra PirateReads «read»-hylden.
 * Bruges til at indsnævre discovery (fx ingen børnebøger/MG).
 */
import OpenAI from "openai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getOpenAIKey, hasOpenAIKey } from "./config.js";
import {
  DISCOVERY_MODEL,
  estimateCostUsd,
} from "./versions.js";
import {
  loadPirateReadsLibrary,
  splitGoodreadsTitle,
  normalizeBookKey,
} from "./pirateReads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = join(__dirname, "../../data/reading-profile.json");
const PROFILE_CACHE_DAYS = Number(process.env.READING_PROFILE_CACHE_DAYS || 7);

/** Hårde ekskluderinger — børnebøger / MG / picture books */
const HARD_EXCLUDE_RE =
  /\b(children'?s|kids?|middle[\s-]?grade|\bmg\b|picture book|board book|early reader|chapter book for kids|ages?\s*[3-9]\b|young readers)\b/i;

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function extractJson(text) {
  if (!text) throw new Error("Tomt profil-svar");
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ingen JSON i profil-svar");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function outputText(response) {
  if (response?.output_text) return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function loadCachedProfile() {
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  const dir = dirname(PROFILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf8");
}

function sampleReadTitles(books, limit = 80) {
  const read = (books || []).filter((b) => b.shelf === "read");
  // Tag et blandet udsnit: første (nyeste i API-rækkefølge) + midten
  if (read.length <= limit) return read;
  const head = read.slice(0, Math.floor(limit * 0.7));
  const step = Math.max(1, Math.floor(read.length / (limit - head.length)));
  const rest = [];
  for (let i = head.length; i < read.length && rest.length < limit - head.length; i += step) {
    rest.push(read[i]);
  }
  return [...head, ...rest];
}

/**
 * Byg/caches læseprofil fra PirateReads read-hylden.
 */
export async function getReadingProfile({ force = false } = {}) {
  const cached = loadCachedProfile();
  if (
    !force &&
    cached?.profile &&
    ageDays(cached.generatedAt) <= PROFILE_CACHE_DAYS
  ) {
    return { ...cached, fromCache: true };
  }

  const pr = await loadPirateReadsLibrary({ force: false });
  const sample = sampleReadTitles(pr.books, 80);
  const titleLines = sample.map((b) => {
    const { bare, series } = splitGoodreadsTitle(b.book_title);
    return `- ${bare}${series ? ` [${series}]` : ""} — ${b.book_author || "?"}`;
  });

  const fallbackProfile = {
    audience: "adult",
    includeGenres: ["romantasy", "fantasy romance", "paranormal romance", "reverse harem"],
    excludeGenres: [
      "children's",
      "middle grade",
      "picture books",
      "early readers",
      "middle-grade fantasy without romance",
    ],
    vibeKeywords: [
      "protective MMC",
      "touch her and die",
      "spice",
      "fated mates",
      "morally grey",
    ],
    summary:
      "Adult romantasy / fantasy romance med beskyttende eller mørke helte — ikke børne- eller MG-bøger.",
  };

  if (!hasOpenAIKey() || sample.length < 5) {
    const payload = {
      generatedAt: new Date().toISOString(),
      sampleSize: sample.length,
      readCount: pr.books.filter((b) => b.shelf === "read").length,
      profile: fallbackProfile,
      source: "fallback",
      costUsd: 0,
    };
    saveProfile(payload);
    return { ...payload, fromCache: false };
  }

  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const prompt = `Du analyserer en læsers «har læst»-liste for at styre bogforslag.

Her er et udsnit af titler hun har læst:
${titleLines.join("\n")}

Returnér KUN JSON:
{
  "audience": "adult" | "ya" | "mixed",
  "includeGenres": ["..."],
  "excludeGenres": ["..."],
  "vibeKeywords": ["..."],
  "summary": "2–3 danske sætninger om hvad hun reelt læser"
}

Regler:
- Hvis listen er romantasy / adult fantasy romance / RH / dark romance → audience = "adult"
- excludeGenres SKAL inkludere børnebøger, middle grade, picture books hvis de ikke matcher hendes liste
- Vær konkret ift. tropes (beskyttende MMC, spice, fae, osv.) ud fra titlerne
- Opdig ikke genrer der ikke fremgår`;

  const response = await client.responses.create({
    model: DISCOVERY_MODEL,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content:
          "Du laver læseprofiler til romantasy-discovery. Returnér KUN JSON. Vær streng: børne-/MG-bøger hører ikke hjemme hos en adult romantasy-læser.",
      },
      { role: "user", content: prompt },
    ],
  });

  const usage = response.usage || {};
  const cost = estimateCostUsd(
    DISCOVERY_MODEL,
    usage.input_tokens || 0,
    usage.output_tokens || 0
  );

  let parsed;
  try {
    parsed = extractJson(outputText(response));
  } catch {
    parsed = fallbackProfile;
  }

  const profile = {
    audience: parsed.audience || "adult",
    includeGenres: Array.isArray(parsed.includeGenres)
      ? parsed.includeGenres.map(String)
      : fallbackProfile.includeGenres,
    excludeGenres: Array.isArray(parsed.excludeGenres)
      ? [...new Set([...parsed.excludeGenres.map(String), ...fallbackProfile.excludeGenres])]
      : fallbackProfile.excludeGenres,
    vibeKeywords: Array.isArray(parsed.vibeKeywords)
      ? parsed.vibeKeywords.map(String)
      : fallbackProfile.vibeKeywords,
    summary: String(parsed.summary || fallbackProfile.summary).trim(),
  };

  // Adult-læsere: tving børne-ekskluderinger ind
  if (profile.audience === "adult" || profile.audience === "ya") {
    for (const g of fallbackProfile.excludeGenres) {
      if (!profile.excludeGenres.some((x) => x.toLowerCase() === g.toLowerCase())) {
        profile.excludeGenres.push(g);
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sampleSize: sample.length,
    readCount: pr.books.filter((b) => b.shelf === "read").length,
    profile,
    source: "openai",
    costUsd: cost,
  };
  saveProfile(payload);
  console.log(
    `[reading-profile] audience=${profile.audience}, sample=${sample.length}, cost=$${cost.toFixed(4)}`
  );
  return { ...payload, fromCache: false };
}

/**
 * Hurtig heuristik: ser kandidaten ud som børne-/MG-bog?
 */
export function looksLikeChildrensBook(candidate) {
  const blob = [
    candidate?.title,
    candidate?.author,
    ...(candidate?.matchedSignals || []),
    ...(candidate?.sources || []).map((s) => s.context || ""),
  ]
    .join(" ")
    .toLowerCase();

  if (HARD_EXCLUDE_RE.test(blob)) return true;

  // Kendte børne-/MG-serier der ofte siver ind
  const kidsSeries = [
    "harry potter",
    "percy jackson",
    "narnia",
    "wings of fire",
    "warriors erin hunter",
    "diary of a wimpy",
    "magic tree house",
  ];
  const key = normalizeBookKey(candidate?.title || "");
  return kidsSeries.some((k) => key.includes(normalizeBookKey(k)) || blob.includes(k));
}

/**
 * Filtrér kandidater mod læseprofil (AI-batch + hard rules).
 */
export async function filterByReadingProfile(candidates, profilePayload = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidates: [], filteredOut: 0, costUsd: 0, failed: false };
  }

  const profileWrap = profilePayload || (await getReadingProfile({ force: false }));
  const profile = profileWrap.profile || profileWrap;

  // 1) Hårde regler først
  let kept = [];
  let hardRemoved = 0;
  for (const c of candidates) {
    if (looksLikeChildrensBook(c)) {
      hardRemoved += 1;
      continue;
    }
    kept.push(c);
  }

  if (!hasOpenAIKey() || kept.length === 0) {
    return {
      candidates: kept,
      filteredOut: candidates.length - kept.length,
      costUsd: 0,
      failed: false,
      hardRemoved,
      profile,
    };
  }

  // 2) Let AI-check i batches — passer til profil?
  const BATCH = 30;
  const okKeys = new Set();
  let costUsd = 0;
  let failed = false;

  const client = new OpenAI({ apiKey: getOpenAIKey() });

  for (let i = 0; i < kept.length; i += BATCH) {
    const batch = kept.slice(i, i + BATCH);
    const items = batch.map((c, idx) => ({
      id: i + idx,
      title: c.title,
      author: c.author || null,
      context:
        (c.sources && c.sources[0]?.context) ||
        (c.matchedSignals || []).join(", ") ||
        c.title,
    }));

    const prompt = `Læseprofil for brugeren:
${JSON.stringify(profile, null, 2)}

Bedøm om hver bog passer til profilen (isMatch=true) eller ej.
isMatch=false hvis: børnebog, middle grade, picture book, ren non-romance high fantasy til børn, eller klart uden for includeGenres.

Returnér KUN JSON:
{ "results": [ { "id": 0, "title": "...", "isMatch": true }, ... ] }

Bøger:
${JSON.stringify(items, null, 2)}`;

    try {
      const response = await client.responses.create({
        model: DISCOVERY_MODEL,
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "Du filtrerer bogforslag mod en adult romantasy-læseprofil. Returnér KUN JSON. Vær streng over for børne-/MG-bøger.",
          },
          { role: "user", content: prompt },
        ],
      });
      const usage = response.usage || {};
      costUsd += estimateCostUsd(
        DISCOVERY_MODEL,
        usage.input_tokens || 0,
        usage.output_tokens || 0
      );
      const parsed = extractJson(outputText(response));
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      if (!results.length) {
        failed = true;
        for (const c of batch) okKeys.add(normalizeBookKey(c.title) + "||" + normalizeBookKey(c.author));
        continue;
      }
      for (const r of results) {
        if (r?.isMatch !== true) continue;
        let book = null;
        if (typeof r.id === "number" && r.id >= 0 && r.id < kept.length) {
          book = kept[r.id];
        } else {
          book = batch.find(
            (c) => normalizeBookKey(c.title) === normalizeBookKey(r.title)
          );
        }
        if (book) {
          okKeys.add(
            normalizeBookKey(book.title) + "||" + normalizeBookKey(book.author)
          );
        }
      }
    } catch (err) {
      console.warn("[reading-profile] filter batch fejlede:", err.message);
      failed = true;
      for (const c of batch) {
        okKeys.add(normalizeBookKey(c.title) + "||" + normalizeBookKey(c.author));
      }
    }
  }

  const finalKept = failed && okKeys.size === kept.length
    ? kept
    : kept.filter((c) =>
        okKeys.has(
          normalizeBookKey(c.title) + "||" + normalizeBookKey(c.author)
        )
      );

  const filteredOut = candidates.length - finalKept.length;
  console.log(
    `[reading-profile] ${finalKept.length} beholdt, ${filteredOut} fjernet (heraf ${hardRemoved} hard-exclude)`
  );

  return {
    candidates: finalKept,
    filteredOut,
    costUsd,
    failed,
    hardRemoved,
    profile,
  };
}

/**
 * Tilføj adult/romantasy-fokus til søgestrenge.
 */
export function sharpenQueriesForProfile(queries, profile) {
  const audience = profile?.audience || "adult";
  const prefix = audience === "adult" ? "adult romantasy" : "romantasy";
  return (queries || []).map((q) => {
    const lower = q.toLowerCase();
    if (lower.includes("romantasy") || lower.includes("adult")) return q;
    // Tilføj ikke til "if you liked" (allerede specifikke)
    if (lower.includes("if you liked")) return q;
    return `${q} ${prefix}`.trim();
  });
}

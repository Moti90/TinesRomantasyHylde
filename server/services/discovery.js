/**
 * Discovery – find nye romantasy-bøger via faste signatur-søgninger.
 * Punkt 1–3: smags-DNA, queries, kørsel + cache. (API/UI kommer senere.)
 */
import OpenAI from "openai";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { getOpenAIKey, hasOpenAIKey } from "./config.js";
import { loadSeries } from "./store.js";
import { parseTineScore } from "./columns.js";
import { stableHash } from "./hash.js";
import {
  DISCOVERY_CACHE_DAYS,
  DISCOVERY_MODEL,
  DISCOVERY_PROMPT_VERSION,
  estimateCostUsd,
} from "./versions.js";
import {
  loadPirateReadsLibrary,
  filterAgainstPirateReads,
} from "./pirateReads.js";
import {
  getReadingProfile,
  filterByReadingProfile,
  sharpenQueriesForProfile,
  looksLikeChildrensBook,
} from "./readingProfile.js";
import {
  loadTasteProfile,
  formatTasteProfileForPrompt,
  buildTasteDiscoveryQueries,
  listTasteParametersForTeaser,
} from "./tasteProfile.js";
import { dataPath, getDataDir } from "./paths.js";

const DATA_DIR = getDataDir();
const DISCOVERED_PATH = dataPath("discovered.json");
const CACHE_PATH = dataPath("discovery-cache.json");

const MAX_QUERIES_PER_RUN = 10;
const MAX_BOOKS_PER_QUERY = 15;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function normKey(title, author = "") {
  const t = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const a = String(author || "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${t}||${a}`;
}

function titleOnlyKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Google-søgning på titel (+ forfatter), så Tine selv kan vælge kilde.
 */
export function resolveBookSearchUrl(candidate) {
  const title = String(candidate?.title || "").trim();
  if (!title) return null;
  const author = String(candidate?.author || "").trim();
  const q = author ? `${title} ${author}` : title;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function enrichCandidate(c) {
  if (!c || typeof c !== "object") return c;
  return {
    ...c,
    searchUrl: resolveBookSearchUrl(c),
  };
}

function extractJson(text) {
  if (!text) throw new Error("Tomt discovery-svar");
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ingen JSON i discovery-svar");
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

/**
 * Kort signal-label til UI/tags (fra søgestrengen).
 */
export function signalLabelFromQuery(query) {
  const q = String(query || "").trim();
  const quoted = q.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1].slice(0, 48);
  // "if you liked X" → behold starten
  const liked = q.match(/if you liked\s+(.+?)(?:\s+similar|\s*$)/i);
  if (liked?.[1]) return `liked: ${liked[1].replace(/"/g, "").slice(0, 40)}`;
  return q.slice(0, 48);
}

/**
 * 1. Smags-DNA — top-15 / bund-10 uden OpenAI.
 */
export function extractTasteDNA(seriesList = null) {
  const list = seriesList || loadSeries();
  const withName = list.filter((r) => (r["Seriens navn"] || "").trim());

  const scored = withName
    .map((r) => ({
      name: String(r["Seriens navn"] || "").trim(),
      author: String(r["Forfatter"] || "").trim() || null,
      score: parseTineScore(r["Tine-score"]),
      status: String(r.Status || "").trim() || null,
      hasScore:
        r["Tine-score"] != null &&
        r["Tine-score"] !== "" &&
        !Number.isNaN(parseTineScore(r["Tine-score"])),
    }))
    .filter((r) => r.hasScore);

  const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
  const topSerier = byScoreDesc.slice(0, 15).map(({ name, author, score, status }) => ({
    name,
    author,
    score,
    status,
  }));

  const dropped = withName
    .filter((r) => /droppet/i.test(String(r.Status || "")))
    .map((r) => ({
      name: String(r["Seriens navn"] || "").trim(),
      author: String(r["Forfatter"] || "").trim() || null,
      score: parseTineScore(r["Tine-score"]),
      status: String(r.Status || "").trim(),
    }));

  const byScoreAsc = [...scored].sort((a, b) => a.score - b.score);
  const lowScored = byScoreAsc.slice(0, 10).map(({ name, author, score, status }) => ({
    name,
    author,
    score,
    status,
  }));

  // Bund = lave scores + droppet (dedupe på navn)
  const bundMap = new Map();
  for (const row of [...lowScored, ...dropped]) {
    const key = titleOnlyKey(row.name);
    if (!key) continue;
    if (!bundMap.has(key)) bundMap.set(key, row);
  }
  const bundSerier = [...bundMap.values()].slice(0, 10);

  return {
    topSerier,
    bundSerier,
    stats: {
      totalSeries: list.length,
      scoredCount: scored.length,
      topCount: topSerier.length,
      bundCount: bundSerier.length,
    },
  };
}

/**
 * 2. Signatur-søgninger — naturligt sprog, max 10.
 * Bruger Tines eksplicitte bogprofil + top-scorerede serier.
 */
export function buildDiscoveryQueries(topSerier = []) {
  const fromTaste = buildTasteDiscoveryQueries(loadTasteProfile());
  const likedFromScores = [];
  for (const s of (topSerier || []).slice(0, 2)) {
    const title = (s.name || "").trim();
    if (!title) continue;
    likedFromScores.push(
      `"if you liked ${title}" similar finished adult romantasy series`
    );
  }

  const seen = new Set();
  const out = [];
  for (const q of [...fromTaste, ...likedFromScores]) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out.slice(0, MAX_QUERIES_PER_RUN);
}

function loadDiscoveryCache() {
  ensureDataDir();
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveDiscoveryCache(payload) {
  ensureDataDir();
  writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function loadDiscovered() {
  ensureDataDir();
  if (!existsSync(DISCOVERED_PATH)) {
    return { lastRun: null, candidates: [] };
  }
  try {
    const data = JSON.parse(readFileSync(DISCOVERED_PATH, "utf8"));
    return {
      lastRun: data.lastRun || null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
    };
  } catch {
    return { lastRun: null, candidates: [] };
  }
}

function saveDiscovered(data) {
  ensureDataDir();
  writeFileSync(DISCOVERED_PATH, JSON.stringify(data, null, 2), "utf8");
}

function existingSeriesKeys(seriesList) {
  const keys = new Set();
  const titles = new Set();
  for (const r of seriesList) {
    const name = r["Seriens navn"] || "";
    const author = r["Forfatter"] || "";
    const first = r["Første bog/titel"] || "";
    keys.add(normKey(name, author));
    titles.add(titleOnlyKey(name));
    if (first) {
      keys.add(normKey(first, author));
      titles.add(titleOnlyKey(first));
    }
  }
  return { keys, titles };
}

function isAlreadyInLibrary(book, existing) {
  const full = normKey(book.title, book.author);
  if (existing.keys.has(full)) return true;
  // Titel-match uden forfatter hvis begge mangler forfatter, eller titel er unik i biblioteket
  const t = titleOnlyKey(book.title);
  if (!t) return true;
  if (existing.titles.has(t)) return true;
  return false;
}

async function searchOneQuery(client, query) {
  const prompt = `Du er en research-assistent. Søg efter: ${query}.
Find konkrete bog- eller serietitler, der nævnes i søgeresultaterne.
Returnér et JSON-objekt med et array "books", hvor hvert element har:

title: bogtitel
author: forfatter (hvis kendt)
sourceUrl: URL til den tråd/artikel, hvor bogen blev anbefalet
context: et kort citat eller beskrivelse af, hvorfor den blev anbefalet ift. søgningen.

Returnér maksimalt ${MAX_BOOKS_PER_QUERY} bøger.
Returnér KUN JSON. Opdig ikke titler eller URL'er.`;

  const response = await client.responses.create({
    model: DISCOVERY_MODEL,
    temperature: 0,
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content:
          "Du søger efter bog-anbefalinger. Returnér KUN JSON med feltet books. Brug kun titler og URL'er fra web_search.",
      },
      { role: "user", content: prompt },
    ],
  });

  const text = outputText(response);
  let books = [];
  try {
    const parsed = extractJson(text);
    books = Array.isArray(parsed.books) ? parsed.books : [];
  } catch (err) {
    console.warn(`[discovery] JSON-parse fejlede for "${query}":`, err.message);
    books = [];
  }

  const usage = response.usage || {};
  const cost = estimateCostUsd(
    DISCOVERY_MODEL,
    usage.input_tokens || 0,
    usage.output_tokens || 0
  );

  const signal = signalLabelFromQuery(query);
  const normalized = books
    .map((b) => ({
      title: String(b?.title || "").trim(),
      author: String(b?.author || "").trim() || null,
      sourceUrl: String(b?.sourceUrl || b?.url || "").trim() || null,
      context: String(b?.context || "").trim() || null,
      signal,
      query,
    }))
    .filter((b) => b.title.length >= 2)
    .slice(0, MAX_BOOKS_PER_QUERY);

  return { books: normalized, usage, cost, signal };
}

/**
 * Merge rå hits → kandidater med discoveryScore + sources.
 * Bevarer status for allerede kendte kandidater (ignored/added).
 */
function mergeCandidates(rawBooks, existingCandidates, seriesList) {
  const existing = existingSeriesKeys(seriesList);
  const prevByKey = new Map();
  for (const c of existingCandidates || []) {
    prevByKey.set(normKey(c.title, c.author), c);
  }

  /** @type {Map<string, any>} */
  const map = new Map();

  for (const hit of rawBooks) {
    if (isAlreadyInLibrary(hit, existing)) continue;

    const key = normKey(hit.title, hit.author || "");
    let entry = map.get(key);
    if (!entry) {
      const prev = prevByKey.get(key);
      entry = {
        title: hit.title,
        author: hit.author,
        discoveryScore: 0,
        matchedSignals: [],
        sources: [],
        status: prev?.status === "ignored" || prev?.status === "added"
          ? prev.status
          : "new",
        _querySet: new Set(),
      };
      map.set(key, entry);
    }

    if (!entry._querySet.has(hit.query)) {
      entry._querySet.add(hit.query);
      entry.discoveryScore = entry._querySet.size;
    }

    if (hit.signal && !entry.matchedSignals.includes(hit.signal)) {
      entry.matchedSignals.push(hit.signal);
    }

    const url = hit.sourceUrl || "";
    const already = entry.sources.some(
      (s) => s.url === url && s.signal === hit.signal
    );
    if (!already && (url || hit.context)) {
      entry.sources.push({
        url: url || null,
        context: hit.context,
        signal: hit.signal,
      });
    }
  }

  const candidates = [...map.values()]
    .map(({ _querySet, ...rest }) => enrichCandidate(rest))
    .sort((a, b) => b.discoveryScore - a.discoveryScore || a.title.localeCompare(b.title));

  return candidates;
}

/**
 * Genre-filter: behold kun fantasy romance / romantasy.
 * Fail-safe: ved API-fejl returneres alle kandidater uændret.
 * @param {Array} candidates
 * @param {OpenAI} [client]
 * @returns {Promise<{ candidates: Array, costUsd: number, filteredOut: number, failed: boolean }>}
 */
export async function filterByGenre(candidates, client = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidates: [], costUsd: 0, filteredOut: 0, failed: false };
  }

  const openai =
    client ||
    (hasOpenAIKey() ? new OpenAI({ apiKey: getOpenAIKey() }) : null);

  if (!openai) {
    console.warn("[discovery] Ingen OpenAI-nøgle til genre-filter — beholder alle");
    return {
      candidates,
      costUsd: 0,
      filteredOut: 0,
      failed: true,
    };
  }

  const BATCH_SIZE = 30;
  const romantasyKeys = new Set();
  let costUsd = 0;
  let anyBatchFailed = false;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const booksForPrompt = batch.map((c, idx) => {
      const ctx =
        (Array.isArray(c.sources) && c.sources[0]?.context) ||
        c.title;
      return {
        id: i + idx,
        title: c.title,
        author: c.author || null,
        context: String(ctx).slice(0, 280),
        signals: c.matchedSignals || [],
      };
    });

    const prompt = `Du klassificerer bøger som romantasy / fantasy romance eller ej.

Definition af romantasy (isRomantasy = true):
Bøger, der kombinerer fantasy (sekundær verden, magi, overnaturlige væsner, drager osv.) med en central romance. Ikke urban fantasy uden romance-fokus, ikke ren contemporary, ikke high fantasy uden romance.

Returnér KUN JSON på formen:
{
  "results": [
    { "id": 0, "title": "...", "isRomantasy": true },
    ...
  ]
}

Bedøm disse bøger (ét resultat pr. id):
${JSON.stringify(booksForPrompt, null, 2)}`;

    try {
      console.log(
        `[discovery] Genre-filter batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} bøger`
      );
      const response = await openai.responses.create({
        model: DISCOVERY_MODEL,
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "Du er genre-klassifikator for romantasy. Returnér KUN JSON. Vær streng: contemporary romance, dark romance uden fantasy, og ren fantasy uden romance = false.",
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
      for (const r of results) {
        if (r?.isRomantasy !== true) continue;

        let book = null;
        if (
          typeof r.id === "number" &&
          r.id >= 0 &&
          r.id < candidates.length
        ) {
          book = candidates[r.id];
        } else {
          const title = String(r.title || "").trim();
          book = batch.find(
            (c) => titleOnlyKey(c.title) === titleOnlyKey(title)
          );
        }
        if (book) romantasyKeys.add(normKey(book.title, book.author));
      }

      // If model returned nothing parseable, fail-safe for this batch
      if (results.length === 0) {
        console.warn("[discovery] Genre-filter: tomt results — beholder batch");
        anyBatchFailed = true;
        for (const c of batch) romantasyKeys.add(normKey(c.title, c.author));
      }
    } catch (err) {
      console.warn("[discovery] Genre-filter fejlede:", err.message);
      anyBatchFailed = true;
      // Fail-safe: keep all in this batch
      for (const c of batch) romantasyKeys.add(normKey(c.title, c.author));
    }
  }

  if (anyBatchFailed && romantasyKeys.size === candidates.length) {
    // Entire filter failed → return all unchanged
    return {
      candidates,
      costUsd,
      filteredOut: 0,
      failed: true,
    };
  }

  const kept = candidates.filter((c) =>
    romantasyKeys.has(normKey(c.title, c.author))
  );
  const filteredOut = candidates.length - kept.length;
  console.log(
    `[discovery] Genre-filter: ${kept.length} romantasy beholdt, ${filteredOut} fjernet`
  );

  return { candidates: kept, costUsd, filteredOut, failed: false };
}

/**
 * 3. Kør discovery (med 7-dages query-cache).
 * @param {{ force?: boolean }} opts
 */
export async function runDiscovery(opts = {}) {
  const force = Boolean(opts.force);
  if (!hasOpenAIKey()) {
    throw new Error("OpenAI-nøgle mangler — kan ikke køre discovery");
  }

  const seriesList = loadSeries();
  const dna = extractTasteDNA(seriesList);
  let queries = buildDiscoveryQueries(dna.topSerier).slice(
    0,
    MAX_QUERIES_PER_RUN
  );

  // Indsnævr søgninger efter hendes reelle læseprofil (PirateReads read)
  let readingProfileMeta = null;
  try {
    const rp = await getReadingProfile({ force: false });
    readingProfileMeta = {
      audience: rp.profile?.audience,
      summary: rp.profile?.summary,
      fromCache: rp.fromCache,
      readCount: rp.readCount,
    };
    queries = sharpenQueriesForProfile(queries, rp.profile).slice(
      0,
      MAX_QUERIES_PER_RUN
    );
    console.log(
      `[discovery] Læseprofil: ${rp.profile?.audience} (${rp.readCount} læste) — ${rp.fromCache ? "cache" : "ny"}`
    );
  } catch (err) {
    console.warn("[discovery] Læseprofil sprang over:", err.message);
  }

  const queriesHash = stableHash({
    queries,
    promptVersion: DISCOVERY_PROMPT_VERSION,
    model: DISCOVERY_MODEL,
    readingAudience: readingProfileMeta?.audience || null,
  });

  const prevDiscovered = loadDiscovered();
  let cache = loadDiscoveryCache();
  let fromCache = false;
  let rawBooks = [];
  let meta = {
    queriesRun: 0,
    queriesFailed: 0,
    estimatedCostUsd: 0,
    genreFilterCostUsd: 0,
    filteredOutByGenre: 0,
    filteredOutByPirateReads: 0,
    filteredOutByReadingProfile: 0,
    pirateReadsFromCache: null,
    pirateReadsCount: 0,
    readingProfile: null,
    queries,
  };

  const cacheValid =
    !force &&
    cache &&
    cache.queriesHash === queriesHash &&
    cache.promptVersion === DISCOVERY_PROMPT_VERSION &&
    ageDays(cache.savedAt) <= DISCOVERY_CACHE_DAYS &&
    Array.isArray(cache.rawBooks);

  const client = new OpenAI({ apiKey: getOpenAIKey() });

  if (cacheValid) {
    fromCache = true;
    rawBooks = cache.rawBooks;
    meta.estimatedCostUsd = 0;
    meta.queriesRun = 0;
    console.log(
      `[discovery] Cache hit (${DISCOVERY_CACHE_DAYS}d) — genbruger ${rawBooks.length} rå hits`
    );
  } else {
    for (const query of queries) {
      try {
        console.log(`[discovery] Søger: ${query}`);
        const result = await searchOneQuery(client, query);
        rawBooks.push(...result.books);
        meta.queriesRun += 1;
        meta.estimatedCostUsd += result.cost || 0;
        console.log(
          `[discovery] → ${result.books.length} bøger (signal: ${result.signal})`
        );
      } catch (err) {
        meta.queriesFailed += 1;
        console.warn(`[discovery] Fejl for "${query}":`, err.message);
      }
    }

    saveDiscoveryCache({
      queriesHash,
      promptVersion: DISCOVERY_PROMPT_VERSION,
      model: DISCOVERY_MODEL,
      savedAt: new Date().toISOString(),
      queries,
      rawBooks,
      meta: {
        queriesRun: meta.queriesRun,
        queriesFailed: meta.queriesFailed,
        estimatedCostUsd: meta.estimatedCostUsd,
      },
    });
  }

  let candidates = mergeCandidates(
    rawBooks,
    prevDiscovered.candidates,
    seriesList
  );

  const beforeGenre = candidates.length;
  const genreResult = await filterByGenre(candidates, client);
  candidates = genreResult.candidates;
  meta.genreFilterCostUsd = genreResult.costUsd;
  meta.filteredOutByGenre = genreResult.filteredOut;
  meta.genreFilterFailed = genreResult.failed;
  meta.estimatedCostUsd += genreResult.costUsd;

  console.log(
    `[discovery] Efter merge: ${beforeGenre} → efter genre-filter: ${candidates.length}`
  );

  // Filtrér bøger Tine allerede har på PirateReads (læst / læser / TBR)
  try {
    const pr = await loadPirateReadsLibrary({ force: false });
    meta.pirateReadsFromCache = pr.fromCache;
    meta.pirateReadsCount = pr.books?.length || 0;
    const beforePr = candidates.length;
    const prFilter = filterAgainstPirateReads(candidates, pr.index);
    candidates = prFilter.kept;
    meta.filteredOutByPirateReads = prFilter.removedCount;
    console.log(
      `[discovery] PirateReads: ${pr.books.length} bøger (${pr.fromCache ? "cache" : "live"}) — fjernede ${prFilter.removedCount} (${beforePr} → ${candidates.length})`
    );
    if (prFilter.removed.length && prFilter.removed.length <= 15) {
      console.log(
        "[discovery] Fjernet pga. PirateReads:",
        prFilter.removed.map((c) => c.title).join("; ")
      );
    }
  } catch (err) {
    console.warn(
      "[discovery] PirateReads-filter sprang over:",
      err.message
    );
    meta.pirateReadsError = err.message;
  }

  // Indsnævr yderligere efter læseprofil (ingen børnebøger m.m.)
  try {
    meta.readingProfile = readingProfileMeta;
    const rpFilter = await filterByReadingProfile(candidates);
    meta.filteredOutByReadingProfile = rpFilter.filteredOut;
    meta.estimatedCostUsd += rpFilter.costUsd || 0;
    candidates = rpFilter.candidates;
    console.log(
      `[discovery] Læseprofil-filter: fjernede ${rpFilter.filteredOut} → ${candidates.length} tilbage`
    );
  } catch (err) {
    console.warn("[discovery] Læseprofil-filter sprang over:", err.message);
    meta.readingProfileError = err.message;
  }

  const payload = {
    lastRun: new Date().toISOString(),
    tasteDNA: {
      topSerier: dna.topSerier.map((s) => ({
        name: s.name,
        author: s.author,
        score: s.score,
      })),
      bundSerier: dna.bundSerier.map((s) => ({
        name: s.name,
        author: s.author,
        score: s.score,
      })),
    },
    queries,
    fromCache,
    candidates,
  };
  saveDiscovered(payload);

  const newCount = candidates.filter((c) => c.status === "new").length;
  return {
    lastRun: payload.lastRun,
    fromCache,
    candidateCount: candidates.length,
    newCount,
    queries: queries.length,
    meta,
    tasteDNA: dna,
    path: DISCOVERED_PATH,
  };
}

export function getDiscoveredPath() {
  return DISCOVERED_PATH;
}

export function getDiscoveryCachePath() {
  return CACHE_PATH;
}

/** Læs gemte kandidater. */
export async function listDiscovered({
  includeAdded = false,
  applyPirateReads = true,
} = {}) {
  const data = loadDiscovered();
  let list = data.candidates || [];
  if (!includeAdded) {
    list = list.filter((c) => c.status === "new");
  } else {
    list = list.filter((c) => c.status !== "ignored");
  }

  // Filtrér PirateReads-hylder + læseprofil (ingen børnebøger)
  let pirateReadsMeta = null;
  let readingProfileMeta = null;
  if (applyPirateReads) {
    try {
      const pr = await loadPirateReadsLibrary({ force: false });
      const filtered = filterAgainstPirateReads(list, pr.index);
      pirateReadsMeta = {
        filteredOut: filtered.removedCount,
        librarySize: pr.books.length,
        fromCache: pr.fromCache,
      };
      list = filtered.kept;
    } catch (err) {
      console.warn("[discovery/list] PirateReads:", err.message);
      pirateReadsMeta = { error: err.message };
    }

    try {
      // På list: kun billige hard-regler + profil-meta (AI-batch kører ved runDiscovery)
      const before = list.length;
      list = list.filter((c) => !looksLikeChildrensBook(c));
      const rp = await getReadingProfile({ force: false });
      readingProfileMeta = {
        filteredOut: before - list.length,
        hardRemoved: before - list.length,
        audience: rp.profile?.audience,
        summary: rp.profile?.summary,
        fromCache: rp.fromCache,
      };
    } catch (err) {
      console.warn("[discovery/list] Læseprofil:", err.message);
      readingProfileMeta = { error: err.message };
    }
  }

  list = [...list]
    .map(enrichCandidate)
    .sort((a, b) => b.discoveryScore - a.discoveryScore);
  return {
    lastRun: data.lastRun,
    candidates: list,
    fromCache: data.fromCache,
    pirateReads: pirateReadsMeta,
    readingProfile: readingProfileMeta,
  };
}

function findCandidateIndex(candidates, title, author = null) {
  const t = titleOnlyKey(title);
  if (!t) return -1;
  const a = author ? titleOnlyKey(author) : null;
  let idx = candidates.findIndex((c) => {
    if (titleOnlyKey(c.title) !== t) return false;
    if (a && c.author && titleOnlyKey(c.author) !== a) return false;
    return true;
  });
  if (idx < 0) {
    idx = candidates.findIndex((c) => titleOnlyKey(c.title) === t);
  }
  return idx;
}

/** Sæt status ignored for en kandidat. */
export function ignoreDiscovered(title, author = null) {
  const data = loadDiscovered();
  const idx = findCandidateIndex(data.candidates, title, author);
  if (idx < 0) throw new Error("Kandidat ikke fundet");
  data.candidates[idx].status = "ignored";
  saveDiscovered(data);
  return data.candidates[idx];
}

function tokenizeSignals(signals = [], sources = []) {
  const parts = [];
  for (const s of signals) parts.push(String(s || "").toLowerCase());
  for (const src of sources) {
    if (src?.context) parts.push(String(src.context).toLowerCase());
    if (src?.signal) parts.push(String(src.signal).toLowerCase());
  }
  const text = parts.join(" ");
  return new Set(
    text
      .replace(/[^a-z0-9æøå\s]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

const SIGNAL_HINTS = [
  { re: /touch her and die|thad/i, col: "Touch her and die-vibe (0-5)" },
  { re: /bodyguard/i, col: "Bodyguard-vibe (0-5)" },
  { re: /protect|beskytt/i, col: "Beskyttende helt(e) (0-5)" },
  { re: /rhysand|morally grey|alpha/i, col: "Rhysand-faktoren" },
  { re: /spice|steam/i, col: "Spice/erotik (0-5)" },
  { re: /hangover/i, col: "Book hangover (0-5)" },
];

/**
 * Find 2–3 mest lignende serier i biblioteket.
 */
export function findSimilarSeries(candidate, seriesList = null, limit = 3) {
  const list = seriesList || loadSeries();
  const tokens = tokenizeSignals(
    candidate.matchedSignals || [],
    candidate.sources || []
  );
  const sourceBlob = (candidate.sources || [])
    .map((s) => `${s.context || ""} ${s.signal || ""}`)
    .join(" ")
    .toLowerCase();

  const scored = list
    .map((row) => {
      const name = String(row["Seriens navn"] || "");
      const tine = parseTineScore(row["Tine-score"]);
      if (!name || tine <= 0) return null;

      let overlap = 0;
      const nameTokens = tokenizeSignals([name, row.Forfatter || ""]);
      for (const t of nameTokens) {
        if (tokens.has(t) || sourceBlob.includes(t)) overlap += 2;
      }

      const minder = String(row["Minder mest om"] || "").toLowerCase();
      for (const t of tokens) {
        if (minder.includes(t)) overlap += 1;
      }

      for (const hint of SIGNAL_HINTS) {
        const hitSignal = (candidate.matchedSignals || []).some((s) =>
          hint.re.test(s)
        );
        if (!hitSignal) continue;
        const val = row[hint.col];
        const n = typeof val === "number" ? val : parseFloat(String(val));
        if (!Number.isNaN(n) && n >= 3.5) overlap += 2;
        if (typeof val === "string" && /ja|høj|rhys/i.test(val)) overlap += 2;
      }

      // Bonus for højt scorerede favoritter (kalibreringsanker)
      const scoreBonus = tine >= 95 ? 3 : tine >= 90 ? 2 : tine >= 85 ? 1 : 0;
      const similarity = overlap + scoreBonus * 0.5;

      return {
        name,
        author: row.Forfatter || null,
        tineScore: tine,
        similarity,
        row,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.similarity - a.similarity || b.tineScore - a.tineScore
    );

  // Altid mindst top-scorerede som fallback
  if (scored.length === 0) {
    return [...list]
      .map((row) => ({
        name: row["Seriens navn"],
        author: row.Forfatter || null,
        tineScore: parseTineScore(row["Tine-score"]),
        similarity: 0,
        row,
      }))
      .filter((r) => r.name && r.tineScore > 0)
      .sort((a, b) => b.tineScore - a.tineScore)
      .slice(0, limit);
  }

  return scored.slice(0, limit);
}

function slimReference(ref) {
  const r = ref.row;
  return {
    name: ref.name,
    author: ref.author,
    tineScore: ref.tineScore,
    similarity: ref.similarity,
    highlights: {
      "Beskyttende helt(e) (0-5)": r["Beskyttende helt(e) (0-5)"],
      "Bodyguard-vibe (0-5)": r["Bodyguard-vibe (0-5)"],
      "Touch her and die-vibe (0-5)": r["Touch her and die-vibe (0-5)"],
      "Rhysand-faktoren": r["Rhysand-faktoren"],
      "Romance i fokus (0-100%)": r["Romance i fokus (0-100%)"],
      "Spice/erotik (0-5)": r["Spice/erotik (0-5)"],
      "Book hangover (0-5)": r["Book hangover (0-5)"],
      "Minder mest om": r["Minder mest om"],
    },
  };
}

const TEASER_SCHEMA_VERSION = 2;

/** Rens AI-felter der ofte kommer som strengen "null". */
function cleanOptionalText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^(null|undefined|none|n\/a|na|ingen|intet)$/i.test(s)) return null;
  return s;
}

function normalizeMatchRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (typeof row === "string") {
        const param = cleanOptionalText(row);
        return param ? { param, evidence: null } : null;
      }
      if (!row || typeof row !== "object") return null;
      const param = cleanOptionalText(row.param || row.label || row.name);
      if (!param) return null;
      return {
        param,
        evidence: cleanOptionalText(row.evidence || row.why || row.note),
      };
    })
    .filter(Boolean);
}

function normalizeStringList(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(cleanOptionalText).filter(Boolean);
}

function isTeaserCacheFresh(teaser) {
  if (!teaser?.blurb) return false;
  if (Number(teaser.schemaVersion) < TEASER_SCHEMA_VERSION) return false;
  // Gamle cache med literal "null"
  for (const key of ["vibe", "whyMatch", "caution"]) {
    const v = teaser[key];
    if (typeof v === "string" && /^(null|undefined)$/i.test(v.trim())) {
      return false;
    }
  }
  return true;
}

/**
 * Kort teaser/review — ingen tilføjelse til biblioteket.
 * Cacher resultatet på kandidaten i discovered.json.
 */
export async function generateTeaser({
  title,
  author = null,
  sources = null,
  matchedSignals = null,
  force = false,
} = {}) {
  if (!title?.trim()) throw new Error("Titel mangler");

  const data = loadDiscovered();
  const idx = findCandidateIndex(data.candidates, title, author);
  const candidate =
    idx >= 0
      ? data.candidates[idx]
      : {
          title: title.trim(),
          author: author || null,
          sources: sources || [],
          matchedSignals: matchedSignals || [],
        };

  if (!force && isTeaserCacheFresh(candidate.teaser)) {
    return {
      teaser: candidate.teaser,
      cached: true,
      candidate: enrichCandidate(candidate),
    };
  }

  if (!hasOpenAIKey()) {
    throw new Error("OpenAI-nøgle mangler");
  }

  const useSources = sources || candidate.sources || [];
  const useSignals = matchedSignals || candidate.matchedSignals || [];
  const refs = findSimilarSeries(
    { ...candidate, sources: useSources, matchedSignals: useSignals },
    loadSeries(),
    2
  ).map(slimReference);

  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const tasteBlock = formatTasteProfileForPrompt();
  const paramChecklist = listTasteParametersForTeaser();
  const prompt = `Skriv en kort dansk teaser om denne romantasy-bog til Tine.
Vær TRANSPARENT: list præcis hvilke af hendes parametre der matcher — kun med belæg i kilderne.

${tasteBlock}

PARAMETER-CHECKLISTE (brug præcis disse labels hvor muligt):
P1: ${JSON.stringify(paramChecklist.priority1)}
P2: ${JSON.stringify(paramChecklist.priority2)}
Trækker ned: ${JSON.stringify(paramChecklist.penalties)}
NO GO: ${JSON.stringify(paramChecklist.noGo)}

Bog: ${candidate.title}
Forfatter: ${candidate.author || "ukendt"}
Signaler der matchede: ${JSON.stringify(useSignals)}
Kilder (brug kun disse — opdig ikke plot):
${JSON.stringify(
  useSources.slice(0, 6).map((s) => ({
    context: s.context,
    signal: s.signal,
  })),
  null,
  2
)}
Ligner lidt favoritter i hendes bibliotek: ${refs.map((r) => r.name).join(", ") || "ukendt"}

Returnér KUN JSON:
{
  "blurb": "2–4 sætninger teaser på dansk — stemning, ikke spoilers",
  "vibe": "én kort linje, fx «beskyttende MMC · high fantasy · HEA-vibes»",
  "whyMatch": "1–2 sætninger opsummering",
  "matchedParams": [
    { "param": "label fra P1/P2-listen", "evidence": "kort belæg fra kilderne" }
  ],
  "uncertainParams": ["labels vi IKKE kan bekræfte fra kilderne"],
  "penaltyHits": ["labels fra trækker-ned hvis relevant"],
  "caution": "kort advarsel ved NO GO / trækker-ned / tynd evidens — ellers udelad feltet eller brug JSON null (ikke teksten null)"
}

Regler:
- matchedParams: KUN parametre med reel belæg. Opdig ikke.
- uncertainParams: det vigtige fra P1 vi ikke kan se i kilderne (ærlighed > gætværk).
- Ingen spoiler. Ingen opfordring til at tilføje til bibliotek.
- Brug JSON null eller udelad felter — ALDRIG strengen "null".`;

  const response = await client.responses.create({
    model: DISCOVERY_MODEL,
    temperature: 0.4,
    input: [
      {
        role: "system",
        content:
          "Du skriver korte, ærlige romantasy-teasers på dansk til Tines smagsprofil. Returnér KUN JSON. Vær transparent om hvilke profil-parametre der matcher. Opdig ikke plot. Flag bully/urban fantasy/ufærdig serie/teenage MC. Brug aldrig strengen null.",
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
  } catch (err) {
    throw new Error(`Kunne ikke parse teaser: ${err.message}`);
  }

  const teaser = {
    schemaVersion: TEASER_SCHEMA_VERSION,
    blurb: String(parsed.blurb || "").trim(),
    vibe: cleanOptionalText(parsed.vibe),
    whyMatch: cleanOptionalText(parsed.whyMatch),
    matchedParams: normalizeMatchRows(parsed.matchedParams),
    uncertainParams: normalizeStringList(parsed.uncertainParams),
    penaltyHits: normalizeStringList(parsed.penaltyHits),
    caution: cleanOptionalText(parsed.caution),
    generatedAt: new Date().toISOString(),
    references: refs.map((r) => ({ name: r.name, tineScore: r.tineScore })),
  };

  if (!teaser.blurb) {
    throw new Error("Tom teaser fra modellen");
  }

  if (idx >= 0) {
    data.candidates[idx].teaser = teaser;
    saveDiscovered(data);
  }

  return {
    teaser,
    cached: false,
    candidate: enrichCandidate(
      idx >= 0 ? data.candidates[idx] : { ...candidate, teaser }
    ),
    meta: { estimatedCostUsd: cost },
  };
}

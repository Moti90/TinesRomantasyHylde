import { getOpenAIKey } from "./config.js";
import { researchInputHash } from "./hash.js";
import {
  RESEARCH_MODEL,
  ANALYSIS_MODEL,
  RESEARCH_PROMPT_VERSION,
  estimateCostUsd,
} from "./versions.js";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { dataPath } from "./paths.js";

const DEBUG_LOG = dataPath("debug-research.log");

/** Midlertidig debug: skriv både til konsol og fil (så Tine kan åbne filen). */
function fsWriteClearDebug() {
  try {
    mkdirSync(dirname(DEBUG_LOG), { recursive: true });
    writeFileSync(
      DEBUG_LOG,
      `=== DEBUG START ${new Date().toISOString()} ===\n`,
      "utf8"
    );
    console.log("Debug-log cleared →", DEBUG_LOG);
  } catch (e) {
    console.warn("Kunne ikke clear debug-log:", e.message);
  }
}

function debugLog(...args) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
    .join(" ");
  console.log(...args);
  try {
    mkdirSync(dirname(DEBUG_LOG), { recursive: true });
    appendFileSync(DEBUG_LOG, line + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

const PROFESSIONAL_HOST_HINTS = [
  "kirkusreviews.com",
  "publishersweekly.com",
  "libraryjournal.com",
  "booklistonline.com",
  "nytimes.com",
  "theguardian.com",
  "washingtonpost.com",
  "npr.org",
  "slate.com",
  "vulture.com",
  "tor.com",
  "reactormag.com",
  "locusmag.com",
  "bookpage.com",
  "quirkbooks.com",
  "entertainmentweekly.com",
  "ew.com",
  "bbc.com",
  "independent.co.uk",
  "telegraph.co.uk",
  "smh.com.au",
];

/** Katalog/streaming/forhandler — aldrig "anmeldelse" eller "official". */
const CATALOG_HOST_HINTS = [
  "books.google.",
  "play.google.com",
  "amazon.",
  "audible.",
  "bookbeat.",
  "storytel.",
  "spotify.com",
  "apple.com/book",
  "barnesandnoble.",
  "bookdepository.",
  "ebay.",
];

const BLOG_HOST_HINTS = [
  "storygraph.com",
  "thestorygraph.com",
  "bookriot.com",
  "fantasybookreview.co.uk",
  "smartbitchestrashybooks.com",
  "romance.io",
  "allaboutromance.com",
  "dearauthor.com",
  "fromthebookworm.com",
  "reddit.com/r/", // håndteres som forum nedenfor; beholdt for completeness
];

function emptyFact() {
  return {
    value: null,
    status: "not_verified",
    confidence: "low",
    sourceIds: [],
  };
}

export function emptyResearch(identity) {
  return {
    identity: {
      title: identity?.title || null,
      author: identity?.author || null,
      series: identity?.series || null,
      bookNumber: identity?.bookNumber ?? null,
      confidence: identity?.identityConfidence || "low",
    },
    facts: {
      publishedBookCount: emptyFact(),
      seriesStatus: emptyFact(),
      audiobook: emptyFact(),
      danishEdition: emptyFact(),
      mofiboAvailability: emptyFact(),
      sameMainCouple: emptyFact(),
      officialDescription: emptyFact(),
    },
    ratings: {
      goodreads: null,
    },
    reviewConsensus: {},
    observations: [],
    sources: [],
    researchedAt: new Date().toISOString(),
    meta: {
      promptVersion: RESEARCH_PROMPT_VERSION,
      model: RESEARCH_MODEL,
      webSearchCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      partial: true,
      warnings: [],
      searchPlan: [],
      evidence: {
        supportingSourceCount: 0,
        conflictThemeCount: 0,
        conflictThemes: [],
        observationCount: 0,
        batchesIntact: true,
        batchCounts: {
          helteprofil: 0,
          romanceprofil: 0,
          plotkarakter: 0,
          helhed: 0,
        },
      },
    },
  };
}

function extractJson(text) {
  if (!text) throw new Error("Tomt research-svar");
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ingen JSON i research-svar");
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

function countWebSearchCalls(response) {
  let n = 0;
  for (const item of response?.output || []) {
    if (item.type === "web_search_call") n += 1;
  }
  return n;
}

/** Rå URL'er fra web_search (ofte flere end modellens JSON-findings). */
export function extractRawSearchUrls(response) {
  const urls = [];
  const seen = new Set();
  const push = (url, title = null) => {
    const u = String(url || "").trim();
    if (!u.startsWith("http") || seen.has(u)) return;
    seen.add(u);
    urls.push({ url: u, title: title || null });
  };

  for (const item of response?.output || []) {
    if (item.type === "web_search_call") {
      for (const src of item.action?.sources || []) {
        push(src.url);
      }
      if (item.action?.url) push(item.action.url);
    }
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      for (const ann of c.annotations || []) {
        if (ann.type === "url_citation") push(ann.url, ann.title);
      }
    }
  }
  return urls;
}

const BATCH_IDS = ["helteprofil", "romanceprofil", "plotkarakter", "helhed"];

function defaultTypeForFocus(focus, url) {
  const classified = classifySourceType(url, "", null);
  if (classified !== "other") return classified;
  if (String(url || "").includes("reddit.com")) return "forum";
  if (String(url || "").includes("goodreads.com")) return "goodreads";
  if (BATCH_IDS.includes(focus)) return "blog";
  return "other";
}

function focusAllowsSource(focus, type, url) {
  const u = String(url || "").toLowerCase();
  if (BATCH_IDS.includes(focus)) {
    // Batch-søgninger: kun anmeldelse-/læser-kilder
    if (["catalog", "official", "publisher", "wikipedia", "other"].includes(type)) {
      return false;
    }
    if (type === "forum") {
      return looksLikeReaderDiscussion(url, "", "");
    }
    if (type === "professional") {
      return looksLikeBookInsight(url, "", type);
    }
    return type === "blog" || type === "goodreads" || type === "forum";
  }
  return true;
}

/**
 * 4 målrettede batches — hver dækker en gruppe håndbogsfelter.
 * Naturlige prompts only (ingen teknisk query).
 */
export function inferLeadCharactersFromResearch(research) {
  const blob = [
    ...(research?.sources || []).map((s) => `${s.title || ""} ${s.summary || ""}`),
    JSON.stringify(research?.reviewConsensus || {}),
  ]
    .join(" ")
    .replace(/\s+/g, " ");

  const mellem = blob.match(
    /mellem\s+([A-ZÆØÅ][\w'’-]+)\s+og\s+([A-ZÆØÅ][\w'’-]+)/
  );
  if (mellem) {
    return { fmc: mellem[1], mmc: mellem[2] };
  }
  const between = blob.match(
    /between\s+([A-Z][\w'’-]+)\s+and\s+([A-Z][\w'’-]+)/i
  );
  if (between) {
    return { fmc: between[1], mmc: between[2] };
  }
  const namedMmc = blob.match(
    /\b(?:MMC|hero|male lead)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
  );
  const namedFmc = blob.match(
    /\b(?:FMC|heroine|female lead)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
  );
  const mmc = namedMmc?.[1] || "";
  const fmc = namedFmc?.[1] || "";
  if (mmc || fmc) return { mmc, fmc };
  return { mmc: "", fmc: "" };
}

export function buildSearchPlan(identity) {
  const title = identity?.title || identity?.series || "book";
  const author = identity?.author || "ukendt forfatter";
  const bog = String(title).trim();
  const forfatter = String(author).trim();

  return [
    {
      id: "helteprofil",
      focus: "helteprofil",
      batch: "helteprofil",
      query: "",
      userPrompt: `Jeg undersøger bogen "${bog}" af ${forfatter}. Find anmeldelser, blogindlæg og diskussioner der beskriver den mandlige hovedperson og hans relation til heltinden.

Læs de 6-10 mest detaljerede resultater og for hver der beskriver hans personlighed eller deres dynamik, notér hvad der siges om:
- Er han beskyttende? Besidderisk? Alpha?
- Er der bodyguard- eller "passer på dig"-dynamik?
- Reagerer han voldsomt når hun er i fare?
- Er han morally grey men respekterer hende?
- Behandler han hende dårligt eller er han respektfuld?

Returnér 6-10 kilder med URL og et kort resume af hvad de siger om ham.`,
    },
    {
      id: "romanceprofil",
      focus: "romanceprofil",
      batch: "romanceprofil",
      query: "",
      userPrompt: `Jeg undersøger bogen "${bog}" af ${forfatter}. Find anmeldelser og blogindlæg der diskuterer romancen og spice-niveauet.

Læs de 6-10 mest detaljerede resultater og notér hvad der siges om:
- Hvor meget fylder romancen i forhold til plottet?
- Hvordan er kemien mellem hovedpersonerne?
- Er der spice? Hvor meget? Er det open door eller fade to black?
- Er spice-scenerne velskrevne eller ligegyldigt fyld?
- Hvilken relationstype er der tale om?

Returnér 6-10 kilder med URL og resume af hvad de siger om romancen og spice.`,
    },
    {
      id: "plotkarakter",
      focus: "plotkarakter",
      batch: "plotkarakter",
      query: "",
      userPrompt: `Jeg undersøger bogen "${bog}" af ${forfatter}. Find dybdegående anmeldelser der analyserer plot, karakterudvikling og pacing.

Læs de 6-10 bedste resultater og notér:
- Er plottet episk eller mere personligt?
- Er der politiske intriger og magtspil?
- Spiller krig og militære konflikter en stor rolle?
- Gennemgår heltinden en stor transformation?
- Er der dyb følelsesmæssig karakterudvikling?
- Er tempoet langsomt, moderat eller hurtigt?

Returnér 6-10 kilder med resume af deres analyse.`,
    },
    {
      id: "helhed",
      focus: "helhed",
      batch: "helhed",
      query: "",
      userPrompt: `Jeg undersøger serien omkring "${bog}" af ${forfatter}. Find anmeldelser og tråde der beskriver den samlede læseoplevelse.

Notér hvad der siges om:
- Giver den book hangover? Tænker man på den længe efter?
- Hvornår i første bog griber den for alvor?
- Holder kvaliteten gennem hele serien eller falder den?
- Er slutningen tilfredsstillende?
- Er der en happy ending?
- Eventuelle trigger warnings
- Hvilke andre serier sammenlignes den med?

Returnér 6-10 kilder med resume af læseoplevelsen.`,
    },
  ];
}

function hostIncludes(url, hints) {
  const u = String(url || "").toLowerCase();
  return hints.some((h) => u.includes(h));
}

function isProfessionalHost(url) {
  return hostIncludes(url, PROFESSIONAL_HOST_HINTS);
}

/** Strip tracking / normalisér til dedup-nøgle. */
export function canonicalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(String(url));
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    const show = u.pathname.match(/\/book\/show\/(\d+)/i);
    if (u.hostname.includes("goodreads.com") && show) {
      u.pathname = `/book/show/${show[1]}`;
      u.search = "";
    }
    if (u.hostname.includes("reddit.com")) {
      // fr.reddit.com / old.reddit.com → reddit.com
      u.hostname = "reddit.com";
      const m = u.pathname.match(
        /\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/?#]+))?/i
      );
      if (m) {
        // Behold slug (til keyword-filter); dedup bruger post-id separat
        u.pathname = m[3]
          ? `/r/${m[1]}/comments/${m[2]}/${m[3]}`
          : `/r/${m[1]}/comments/${m[2]}`;
      } else {
        u.pathname = u.pathname.replace(/\/$/, "");
      }
      u.search = "";
    }
    let out = u.toString();
    if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return String(url).split("#")[0].split("?")[0];
  }
}

/** Branchenyheder / forlags-PR — ikke boganmeldelser. */
export function isIndustryNoise(url, title = "") {
  const blob = `${title} ${url}`.toLowerCase();
  if (
    /letter from london|sales up|parties pack|transformational year|financial.reporting|industry-news|adult-announcements|golden time for children|race for harry|pottermore claims|claims sales|rights sold|book deal|publishing deal|advance for|bookscan|bestsellers? list|print run|acquisition announcement|imprint acquires|film rights|tv rights|optioned for|hollywood|netgalley widget|cover reveal party|preorder campaign/i.test(
      blob
    )
  ) {
    return true;
  }
  // Handels-/branchemagasiner uden egentlig review-path
  if (
    /(thebookseller\.com|bookbrunch\.co|publishingperspectives\.com|shelf-awareness\.com\/(article|news)|publishersmarketplace\.com)/i.test(
      blob
    ) &&
    !/\breview\b|starred review|book review/i.test(blob)
  ) {
    return true;
  }
  if (
    /publishersweekly\.com/.test(blob) &&
    !/\/book-reviews\/|\/reviews\/|review of|starred review/i.test(blob)
  ) {
    if (
      /\/pw\/(by-topic|print)\//i.test(blob) &&
      !/\breview\b/i.test(String(title))
    ) {
      return true;
    }
    // PW deals/news uden review
    if (/\/pw\/(news|deals|by-topic)\//i.test(blob)) return true;
  }
  return false;
}

/** Ser det ud som anmeldelse / læserindsigt om bogen? */
export function looksLikeBookInsight(url, title = "", type = "") {
  const u = String(url || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  if (isIndustryNoise(url, title)) return false;
  if (u.includes("reddit.com")) {
    return looksLikeReaderDiscussion(url, title, "");
  }
  if (
    u.includes("goodreads.com") &&
    (u.includes("/topic/") || u.includes("/review/"))
  ) {
    return looksLikeReaderDiscussion(url, title, "");
  }
  if (u.includes("kirkusreviews.com")) return true;
  if (/\/book-reviews?\/|\/reviews?\/|\/review[-_/]/i.test(u)) return true;
  if (isProfessionalHost(u) && /review/i.test(u + t)) return true;
  if (type === "forum") return looksLikeReaderDiscussion(url, title, "");
  if (type === "blog") return true;
  if (
    type === "professional" &&
    /\breview\b|anmeld|kirkus|booklist|starred/i.test(t + u)
  ) {
    return true;
  }
  if (/\b(book )?review\b|anmeld|spoiler|what to expect|tropes?/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Reddit/fora: kun tråde om læseoplevelse — ikke lore, plot-huller, casting, teorier.
 */
export function looksLikeReaderDiscussion(url = "", title = "", summary = "") {
  const blob = `${title} ${decodeURIComponent(String(url))} ${summary}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  const positive =
    /\b(book review|review|anmeld|thoughts on|just finished|finished reading|first impressions|dnf|spoiler free|what to expect|tropes?\b|spice level|romance|recommend|worth reading|worth it|rating|reread|should i read|is it (good|worth)|loved this book|hated this book)\b/i;

  const loreNoise =
    /\b(where was|missing for|timeline|plot hole|headcanon|fanfic|fan theory|theor(y|ies)|casting|movie|film only|who would win|easter egg|continuity|retcon|sorting hat|dropped off at|what if .+|plothole)\b/i;

  if (loreNoise.test(blob) && !positive.test(blob)) return false;

  if (/reddit\.com/i.test(blob)) {
    return positive.test(blob);
  }
  return positive.test(blob);
}

/**
 * URL bestemmer typen — modellens "type"-felt er kun fallback.
 */
export function classifySourceType(url, title, declared) {
  const u = String(url || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  const d = String(declared || "").toLowerCase();

  if (u.includes("wikipedia.org")) return "wikipedia";
  if (u.includes("fandom.com") || u.includes("explained.today")) return "other";

  if (u.includes("reddit.com")) return "forum";
  if (u.includes("goodreads.com")) {
    if (
      u.includes("/review/") ||
      u.includes("/topic/") ||
      u.includes("/questions/") ||
      u.includes("/ask_the_author") ||
      /discussion|thread|topic/i.test(t)
    ) {
      return "forum";
    }
    return "goodreads";
  }

  if (hostIncludes(u, CATALOG_HOST_HINTS)) return "catalog";

  if (isProfessionalHost(u)) {
    if (isIndustryNoise(url, title)) return "other";
    return "professional";
  }

  if (
    u.includes("storygraph.com") ||
    u.includes("thestorygraph") ||
    hostIncludes(u, BLOG_HOST_HINTS.filter((h) => !h.includes("reddit")))
  ) {
    return "blog";
  }

  if (/kirkus|publishers weekly|library journal|booklist/i.test(t)) {
    if (isIndustryNoise(url, title)) return "other";
    return "professional";
  }
  if (/review|anmeld|book blog|bogblog|recension|spoiler/i.test(t)) {
    return "blog";
  }
  if (
    /official|publisher|forfatter|forlag|author site/i.test(t) ||
    /author\./i.test(u)
  ) {
    return d === "publisher" ? "publisher" : "official";
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
      "professional",
      "other",
    ].includes(d)
  ) {
    if (d === "goodreads" && u && !u.includes("goodreads.com")) return "other";
    if (d === "wikipedia" && u && !u.includes("wikipedia.org")) return "other";
    if (
      (d === "official" || d === "publisher") &&
      hostIncludes(u, CATALOG_HOST_HINTS)
    ) {
      return "catalog";
    }
    if (d === "professional" && isIndustryNoise(url, title)) return "other";
    return d;
  }

  if (u && /novel|book|series|romantasy|fantasy/i.test(u + t)) return "blog";
  return "other";
}

/** Dedup-nøgle: samme Reddit-post = samme key uanset slug/subdomain. */
export function sourceDedupeKey(url, fallback = "") {
  const canon = canonicalizeUrl(url);
  const m = String(canon).match(
    /reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i
  );
  if (m) return `reddit:${m[1].toLowerCase()}:${m[2].toLowerCase()}`;
  return canon || fallback;
}

function sourceTierWeight(type) {
  switch (type) {
    case "professional":
      return 3;
    case "blog":
      return 2;
    case "goodreads":
      return 1;
    case "forum":
      return 1;
    default:
      return 0;
  }
}

function batchWeight(batch) {
  switch (batch) {
    case "helteprofil":
      return 40;
    case "romanceprofil":
      return 30;
    case "plotkarakter":
      return 20;
    case "helhed":
      return 10;
    default:
      return 0;
  }
}

function sourceValueScore(s) {
  const type = s.type;
  const url = String(s.url || "");
  const insight = looksLikeBookInsight(url, s.title, type);
  let score = batchWeight(s.batch || s.focus);
  if (type === "forum" && url.includes("reddit.com")) score += 50;
  else if (type === "forum") score += 35;
  if (type === "blog" && insight) score += 45;
  if (type === "professional" && insight) score += 48;
  if (type === "goodreads") score += 15;
  if (type === "wikipedia" || type === "official") score += 8;
  if (type === "catalog" || type === "other") score += 1;
  if (insight) score += 10;
  // Korte / generiske summaries = lav værdi
  if (String(s.summary || "").trim().length < 40) score -= 20;
  if (isIndustryNoise(url, s.title)) score -= 100;
  if (isPublisherPr(url, s.title)) score -= 100;
  return score;
}

/** Forfatter-/forlagssider — salgstekst, ikke uafhængig evidens. */
export function isPublisherPr(url, title = "") {
  const blob = `${title} ${url}`.toLowerCase();
  if (
    /author\.(com|net|org)|\/publisher\/|forlag|pottermore|bloomsbury\.com|tor\.com\/(blog\/)?announc|orbitbooks\.net|penguinrandomhouse\.com\/books\/|harpercollins\.com\/products/i.test(
      blob
    )
  ) {
    // Tillad egentlige anmeldelsessider på samme domæner, hvis tydeligt markeret
    if (/\breview\b|anmeld|book review|starred/i.test(blob)) return false;
    return true;
  }
  return false;
}

/** Er kilden gyldig romantasy-evidens (ikke PR/branchestøj)? */
export function isRomanticEvidenceSource(source) {
  if (!source?.url && !source?.title) return false;
  if (isIndustryNoise(source.url, source.title)) return false;
  if (isPublisherPr(source.url, source.title)) return false;
  if (["catalog", "official", "publisher", "other"].includes(source.type)) {
    return false;
  }
  return true;
}

/**
 * Behold kun kilde-id'er der findes og tæller som romantasy-evidens.
 */
export function filterValidSourceIds(ids, sources = []) {
  const byId = new Map((sources || []).map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    const source = byId.get(id);
    if (!source || !isRomanticEvidenceSource(source)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const CONSENSUS_THEME_LABELS = {
  romancefokus: "Romance-fokus",
  slowBurn: "Slow burn",
  spice: "Spice",
  enemiesToLovers: "Enemies to lovers",
  friendsToLovers: "Friends to lovers",
  forcedProximity: "Forced proximity",
  relationType: "Relationstype",
  protective: "Beskyttende helt",
  possessiveness: "Possessivitet",
  touchHerAndDie: "Touch her and die",
  rhysandLikeTraits: "Rhysand-træk",
  politicalIntrigue: "Politiske intriger",
  warMilitary: "Krig/militær",
  worldbuilding: "Worldbuilding",
  magicSystem: "Magisystem",
  pacing: "Tempo",
  cliffhangers: "Cliffhangers",
  emotionalIntensity: "Emotionel intensitet",
  characterGrowth: "Karakterudvikling",
  epicPlot: "Episk plot",
};

export function consensusThemeLabel(theme) {
  return CONSENSUS_THEME_LABELS[theme] || theme;
}

/**
 * Let observationslag (ikke fuld claim engine): ét tema → én observation.
 */
export function buildObservations(reviewConsensus = {}) {
  const observations = [];
  for (const [theme, val] of Object.entries(reviewConsensus || {})) {
    if (!val || typeof val !== "object") continue;
    const statement = String(val.finding || "").trim();
    if (!statement) continue;
    const supportingSourceIds = Array.isArray(val.supportingSourceIds)
      ? val.supportingSourceIds
      : [];
    const conflictingSourceIds = Array.isArray(val.conflictingSourceIds)
      ? val.conflictingSourceIds
      : [];
    observations.push({
      id: `obs-${theme}`,
      theme,
      label: consensusThemeLabel(theme),
      statement,
      consensus: val.consensus || "insufficient",
      confidence: val.confidence || "low",
      supportingSourceIds,
      conflictingSourceIds,
      hasConflict: conflictingSourceIds.length > 0,
    });
  }
  return observations;
}

/**
 * Samlet evidens-meta til UI/transparens.
 */
export function buildEvidenceMeta(research) {
  const sources = research?.sources || [];
  const consensus = research?.reviewConsensus || {};
  const observations = research?.observations || buildObservations(consensus);
  const conflictThemes = observations
    .filter((o) => o.hasConflict)
    .map((o) => o.label);
  const byBatch = (b) => sources.filter((s) => s.batch === b).length;
  return {
    supportingSourceCount: sources.filter(isRomanticEvidenceSource).length,
    conflictThemeCount: conflictThemes.length,
    conflictThemes,
    observationCount: observations.length,
    batchesIntact: BATCH_IDS.every((b) => byBatch(b) >= 0),
    batchCounts: {
      helteprofil: byBatch("helteprofil"),
      romanceprofil: byBatch("romanceprofil"),
      plotkarakter: byBatch("plotkarakter"),
      helhed: byBatch("helhed"),
    },
  };
}

function isPlotOnlyNoise(title, summary) {
  const blob = `${title} ${summary}`.toLowerCase();
  if (looksLikeReaderDiscussion("", title, summary)) return false;
  // Kun plot-resumé uden vurderings-signaler
  const hasEval =
    /\b(review|anmeld|spice|tropes?|protective|bodyguard|hangover|pacing|recommend|worth|steam|romance|mmc|heroine|rating)\b/i.test(
      blob
    );
  const plotOnly =
    /\b(plot|summary|synopsis|recap|what happens|spoiler.?free summary)\b/i.test(
      blob
    );
  return plotOnly && !hasEval;
}

/**
 * Behold kilder med værdi, prioriteret efter batch (helteprofil højest).
 * Samme URL må godt overleve i flere batches — ellers stjæler helte/romance
 * Goodreads-siden fra plotkarakter/helhed, og de batches ender på 0.
 */
const MAX_SOURCES_PER_BATCH = 8;
const MAX_SOURCES_TOTAL = 28;
const MAX_PER_HOST_PER_BATCH = 3;
const MAX_GOODREADS_PER_BATCH = 3;
const MAX_GOODREADS_TOTAL = 12;

export function selectValuableSources(sources) {
  if (!Array.isArray(sources)) return [];
  const byCanon = new Map();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] || {};
    const rawUrl = s.url || "";
    const canon = canonicalizeUrl(rawUrl) || `no-url-${i}-${s.title}`;
    const type = classifySourceType(rawUrl, s.title, s.type);
    const batch = BATCH_IDS.includes(s.batch)
      ? s.batch
      : BATCH_IDS.includes(s.focus)
        ? s.focus
        : null;
    const urlKey = sourceDedupeKey(rawUrl, `no-url-${i}-${s.title}`);
    const key = `${batch || "_"}:${urlKey}`;
    const row = {
      title: s.title || "Kilde",
      url: canon || rawUrl || null,
      type,
      batch,
      summary: String(s.summary || "").slice(0, 500),
      focus: s.focus || batch || null,
    };
    if (isIndustryNoise(row.url, row.title)) continue;
    if (isPublisherPr(row.url, row.title)) continue;
    if (isPlotOnlyNoise(row.title, row.summary)) continue;
    if (
      row.type === "forum" &&
      !looksLikeReaderDiscussion(row.url, row.title, row.summary)
    ) {
      continue;
    }
    if (["catalog", "official", "publisher"].includes(row.type)) continue;
    const prev = byCanon.get(key);
    if (!prev || sourceValueScore(row) > sourceValueScore(prev)) {
      byCanon.set(key, row);
    }
  }

  const all = [...byCanon.values()].sort(
    (a, b) => sourceValueScore(b) - sourceValueScore(a)
  );

  const out = [];
  let goodreadsReviews = 0;
  let facts = 0;
  // Host-loft pr. batch — ellers kan romance/plot fylde goodreads.com og nulstille andre batches.
  const hostCount = new Map();
  const goodreadsByBatch = new Map();
  const batchCount = {
    helteprofil: 0,
    romanceprofil: 0,
    plotkarakter: 0,
    helhed: 0,
  };

  for (const s of all) {
    let host = "";
    try {
      host = new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      host = s.url || "";
    }
    const hostKey = `${s.batch || "_"}:${host}`;
    const hn = hostCount.get(hostKey) || 0;
    if (hn >= MAX_PER_HOST_PER_BATCH) continue;

    if (s.type === "goodreads") {
      const gb = goodreadsByBatch.get(s.batch || "_") || 0;
      if (gb >= MAX_GOODREADS_PER_BATCH) continue;
      if (goodreadsReviews >= MAX_GOODREADS_TOTAL) continue;
      goodreadsByBatch.set(s.batch || "_", gb + 1);
      goodreadsReviews += 1;
    } else if (s.type === "wikipedia") {
      if (facts >= 2) continue;
      facts += 1;
    } else if (s.type === "professional" || s.type === "blog" || s.type === "forum") {
      if (
        s.type === "professional" &&
        !looksLikeBookInsight(s.url, s.title, s.type)
      ) {
        continue;
      }
    } else {
      continue;
    }

    const b = s.batch;
    if (b && batchCount[b] != null) {
      if (batchCount[b] >= MAX_SOURCES_PER_BATCH) continue;
      batchCount[b] += 1;
    }

    hostCount.set(hostKey, hn + 1);
    out.push(s);
    if (out.length >= MAX_SOURCES_TOTAL) break;
  }

  return out.map((s, i) => ({
    ...s,
    id: `source-${i + 1}`,
  }));
}

export function normalizeSources(sources) {
  return selectValuableSources(sources);
}

export function summarizeSourceFoundation(sources = []) {
  const byType = (t) => sources.filter((s) => s.type === t).length;
  const byBatch = (b) => sources.filter((s) => s.batch === b).length;
  return {
    helteprofil: byBatch("helteprofil"),
    romanceprofil: byBatch("romanceprofil"),
    plotkarakter: byBatch("plotkarakter"),
    helhed: byBatch("helhed"),
    officialSources: byType("official") + byType("publisher"),
    professionalReviews: byType("professional"),
    reviewsOrBlogs: byType("blog"),
    goodreadsPages: byType("goodreads"),
    readerDiscussions: byType("forum"),
    wikipedia: byType("wikipedia"),
    catalog: byType("catalog"),
    other: byType("other"),
    factSources:
      byType("goodreads") +
      byType("wikipedia") +
      byType("official") +
      byType("publisher"),
    totalSources: sources.length,
    reviewLikeSources:
      byType("professional") + byType("blog") + byType("forum"),
    searchPlanVersion: "batch-v1",
  };
}

function normalizeGoodreads(raw) {
  if (!raw || raw.value == null) return null;
  const conf = raw.matchConfidence || "low";
  if (conf === "low") return null;
  const source = String(raw.source || "Goodreads");
  if (!/^goodreads$/i.test(source)) return null;
  if (raw.titleMatched === false || raw.authorMatched === false) return null;
  const value = Number(raw.value);
  if (Number.isNaN(value) || value < 0 || value > 5) return null;
  return {
    value,
    ratingCount: raw.ratingCount ?? null,
    reviewCount: raw.reviewCount ?? null,
    source: "Goodreads",
    sourceUrl: raw.sourceUrl || null,
    matchConfidence: conf,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
  };
}

function normalizeFact(f) {
  if (!f || typeof f !== "object") return emptyFact();
  const status = [
    "verified",
    "partially_verified",
    "not_verified",
    "conflicting",
  ].includes(f.status)
    ? f.status
    : "not_verified";
  return {
    value: f.value ?? null,
    status,
    confidence: ["high", "medium", "low"].includes(f.confidence)
      ? f.confidence
      : "low",
    sourceIds: Array.isArray(f.sourceIds) ? f.sourceIds : [],
  };
}

/**
 * Forum alene må ikke give high confidence.
 * Professional+blog bør bære consensus.
 * PR/branche-id'er fjernes; konflikter markeres eksplicit.
 */
export function normalizeConsensus(obj, sources = []) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = {};
  if (!obj || typeof obj !== "object") return out;

  for (const [key, val] of Object.entries(obj)) {
    if (!val || typeof val !== "object") continue;
    let confidence = ["high", "medium", "low"].includes(val.confidence)
      ? val.confidence
      : "low";
    let consensus = [
      "strong",
      "moderate",
      "weak",
      "mixed",
      "insufficient",
    ].includes(val.consensus)
      ? val.consensus
      : "insufficient";

    const supporting = filterValidSourceIds(
      Array.isArray(val.supportingSourceIds) ? val.supportingSourceIds : [],
      sources
    );
    const conflicting = filterValidSourceIds(
      Array.isArray(val.conflictingSourceIds) ? val.conflictingSourceIds : [],
      sources
    ).filter((id) => !supporting.includes(id));

    const supportSources = supporting
      .map((id) => byId.get(id))
      .filter(Boolean);
    const weight = supportSources.reduce(
      (sum, s) => sum + sourceTierWeight(s.type),
      0
    );
    const hasProOrBlog = supportSources.some(
      (s) => s.type === "professional" || s.type === "blog"
    );
    const onlyForum =
      supportSources.length > 0 &&
      supportSources.every((s) => s.type === "forum" || s.type === "goodreads");

    if (supporting.length <= 1 && confidence === "high") {
      confidence = "medium";
      if (consensus === "strong") consensus = "moderate";
    }
    if (onlyForum && confidence === "high") {
      confidence = "medium";
      if (consensus === "strong") consensus = "moderate";
    }
    if (!hasProOrBlog && weight < 3 && confidence === "high") {
      confidence = "medium";
    }

    // Synlige konflikter: blandede kilder må ikke fremstå som stærk enighed
    if (conflicting.length > 0) {
      consensus = "mixed";
      if (confidence === "high") confidence = "medium";
    }
    if (!supporting.length && !conflicting.length) {
      if (consensus === "strong" || consensus === "moderate") {
        consensus = "insufficient";
      }
      if (confidence === "high") confidence = "low";
    }

    out[key] = {
      finding: val.finding || "",
      consensus,
      confidence,
      supportingSourceIds: supporting,
      conflictingSourceIds: conflicting,
      hasConflict: conflicting.length > 0,
      supportCount: supporting.length,
      conflictCount: conflicting.length,
    };
  }
  return out;
}

export function normalizeResearch(parsed, identity, usageMeta = {}) {
  const base = emptyResearch(identity);
  // Hvis kalderen har forberedt batchede kilder, bevar dem (intakte id'er/batches)
  const sources = Array.isArray(usageMeta.lockedSources)
    ? usageMeta.lockedSources
    : normalizeSources(parsed.sources);
  const foundation = summarizeSourceFoundation(sources);
  const reviewLike = foundation.reviewLikeSources;
  const partial =
    Boolean(usageMeta.partial) ||
    sources.length < 6 ||
    reviewLike < 2;
  const reviewConsensus = normalizeConsensus(parsed.reviewConsensus, sources);
  const observations = buildObservations(reviewConsensus);
  const evidence = buildEvidenceMeta({
    sources,
    reviewConsensus,
    observations,
  });

  const conflictWarning =
    evidence.conflictThemeCount > 0
      ? `Kilderne er uenige om: ${evidence.conflictThemes.join(", ")}.`
      : null;

  const { lockedSources: _locked, ...restUsage } = usageMeta;

  return {
    ...base,
    identity: {
      title: parsed.identity?.title || identity?.title || null,
      author: parsed.identity?.author || identity?.author || null,
      series: parsed.identity?.series || identity?.series || null,
      bookNumber:
        parsed.identity?.bookNumber ?? identity?.bookNumber ?? null,
      confidence:
        parsed.identity?.confidence ||
        identity?.identityConfidence ||
        "medium",
    },
    facts: {
      publishedBookCount: normalizeFact(parsed.facts?.publishedBookCount),
      seriesStatus: normalizeFact(parsed.facts?.seriesStatus),
      audiobook: normalizeFact(parsed.facts?.audiobook),
      danishEdition: normalizeFact(parsed.facts?.danishEdition),
      mofiboAvailability: normalizeFact(parsed.facts?.mofiboAvailability),
      sameMainCouple: normalizeFact(parsed.facts?.sameMainCouple),
      officialDescription: normalizeFact(parsed.facts?.officialDescription),
    },
    ratings: {
      goodreads: normalizeGoodreads(parsed.ratings?.goodreads),
    },
    reviewConsensus,
    observations,
    sources,
    researchedAt: new Date().toISOString(),
    meta: {
      ...base.meta,
      ...restUsage,
      researchHash: researchInputHash(identity),
      sourceCount: sources.length,
      foundation,
      evidence,
      partial,
      warnings: [
        ...(restUsage.warnings || []),
        ...(partial
          ? [
              "Fandt færre anmeldelser end ønsket — vurderingen bygger på et tyndere udvalg.",
            ]
          : []),
        ...(conflictWarning ? [conflictWarning] : []),
      ],
    },
  };
}

async function runFocusedSearch(client, { id, focus, query, userPrompt, batch }) {
  const batchLabel = batch || focus;
  const debugHelte = batchLabel === "helteprofil";
  const debugRomance = batchLabel === "romanceprofil";
  // Kun naturlig batch-prompt — ingen teknisk søgestreng.
  const promptText = `${userPrompt}

Returnér JSON:
{
  "findings": [
    {
      "title": "...",
      "url": "https://...",
      "type": "professional|blog|forum|goodreads",
      "summary": "1-3 sætninger — VÆR SPECIFIK om tropes/MMC/spice/plot/worldbuilding. Hvis siden har stjerne-/chili-ratings (fx World-Building 4/5), SKAL de med i summary som tal."
    }
  ]
}

Batch-id for denne søgning: ${batchLabel}
Max 10 findings. Opdig ikke URL'er. Tom liste OK hvis intet relevant.`;

  const response = await client.responses.create({
    model: ANALYSIS_MODEL,
    temperature: 0,
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content:
          "Du udfører én fokuseret websøgning til romantasy-vurdering. Returnér KUN JSON. Brug kun URL'er fra web_search-resultater — opdig ikke links. Skip Amazon, forhandler, branchenyheder, forlags-PR, fandom-lore og rene Goodreads-udgavesider uden anmeldelsetekst. Prioritér anmeldelser der beskriver læseoplevelse og tropes.",
      },
      {
        role: "user",
        content: promptText,
      },
    ],
  });

  const text = outputText(response);
  let findings = [];
  try {
    const parsed = extractJson(text);
    findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  } catch (err) {
    console.warn(`Focused search ${id}: JSON-parse fejlede:`, err.message);
  }

  const rawUrls = extractRawSearchUrls(response);

  // === MIDLERTIDIG DEBUG ===
  if (debugHelte) {
    debugLog("\n========== HELTEPROFIL DEBUG ==========");
    debugLog("Batch:", batchLabel, "| id:", id);
    debugLog("\n--- SØGEPROMPT (første 500 tegn) ---");
    debugLog(String(userPrompt || "").slice(0, 500));
    debugLog("...(trunkeret)...");
    debugLog("\n--- RÅ WEB_SEARCH URL'er (via extractRawSearchUrls) ---");
    debugLog("Antal rå URLer:", rawUrls.length);
    if (rawUrls.length === 0) {
      debugLog("INGEN rå sources fundet!");
      debugLog(
        "Response.output types:",
        (response.output || []).map((o) => o.type)
      );
      const ws = (response.output || []).filter((o) => o.type === "web_search_call");
      debugLog("web_search_call count:", ws.length);
      for (const call of ws) {
        debugLog(
          "  action.type:",
          call.action?.type,
          "| sources?",
          Array.isArray(call.action?.sources)
            ? call.action.sources.length
            : "mangler"
        );
      }
    } else {
      rawUrls.forEach((s, i) => {
        debugLog(`  [${i + 1}] ${s.url}`);
        debugLog(`      Titel: ${s.title || "ingen titel"}`);
      });
    }
    debugLog("\n--- MODELLENS FINDINGS (før focusAllowsSource) ---");
    if (findings.length > 0) {
      debugLog("Antal findings fra model:", findings.length);
      findings.forEach((f, i) => {
        debugLog(`  [${i + 1}] ${f.type}: ${f.title}`);
        debugLog(`      URL: ${f.url}`);
        debugLog(
          `      Summary: ${String(f.summary || "").slice(0, 150)}...`
        );
      });
    } else {
      debugLog("NULL eller TOM findings-array fra modellen!");
      debugLog("Rå output (første 800 tegn):");
      debugLog(String(text || "").slice(0, 800) || "INTET OUTPUT_TEXT");
    }
  } else if (debugRomance) {
    debugLog("\n--- ROMANCEPROFIL (til sammenligning) ---");
    debugLog("Rå URLer:", rawUrls.length);
    debugLog("Findings (rå model):", findings.length);
  }
  // === SLUT del 1 DEBUG ===

  const byUrl = new Map();
  const droppedFocus = [];

  for (const f of findings) {
    if (!f?.url) continue;
    const type = classifySourceType(f.url, f.title, f.type);
    if (!focusAllowsSource(focus, type, f.url)) {
      droppedFocus.push({
        stage: "focusAllowsSource/findings",
        url: f.url,
        type,
        title: f.title,
      });
      continue;
    }
    byUrl.set(f.url, {
      title: f.title || "Kilde",
      url: f.url,
      type,
      batch: batchLabel,
      summary: f.summary || "",
      focus,
    });
  }

  for (const raw of rawUrls) {
    if (byUrl.has(raw.url)) continue;
    const type = defaultTypeForFocus(focus, raw.url);
    if (!focusAllowsSource(focus, type, raw.url)) {
      droppedFocus.push({
        stage: "focusAllowsSource/raw",
        url: raw.url,
        type,
        title: raw.title,
      });
      continue;
    }
    byUrl.set(raw.url, {
      title: raw.title || hostnameTitle(raw.url),
      url: raw.url,
      type,
      batch: batchLabel,
      summary: `Fundet via ${batchLabel}-søgning`,
      focus,
    });
  }

  const merged = [...byUrl.values()].slice(0, 12);

  // === MIDLERTIDIG DEBUG filter-trin ===
  if (debugHelte) {
    debugLog("\n--- EFTER focusAllowsSource (merged før selectValuableSources) ---");
    debugLog("Findings+rå før focus-filter:", findings.length + rawUrls.length);
    debugLog("Beholdt i merged:", merged.length);
    if (droppedFocus.length) {
      debugLog("DROPPET af focusAllowsSource:");
      droppedFocus.forEach((d) => {
        debugLog(`  [${d.stage}] ${d.type}: ${d.url}`);
      });
    }
    const asDrafts = merged.map((m) => ({ ...m, batch: batchLabel }));
    const afterSelect = selectValuableSources(asDrafts);
    debugLog("\n--- selectValuableSources kun på denne batch ---");
    debugLog("Før:", asDrafts.length, "| Efter:", afterSelect.length);
    if (asDrafts.length > afterSelect.length) {
      const keptUrls = new Set(afterSelect.map((s) => s.url));
      asDrafts
        .filter((d) => !keptUrls.has(canonicalizeUrl(d.url) || d.url))
        .forEach((d) => {
          debugLog(`  DROPPET af selectValuableSources: ${d.url} (${d.type})`);
          debugLog(
            `    title=${d.title} | summaryLen=${String(d.summary || "").length}`
          );
          debugLog(
            `    industry=${isIndustryNoise(d.url, d.title)} loreForum=${
              d.type === "forum" &&
              !looksLikeReaderDiscussion(d.url, d.title, d.summary)
            } plotOnly=${isPlotOnlyNoise(d.title, d.summary)} publisherPr=${isPublisherPr(d.url, d.title)}`
          );
        });
    }
    debugLog("========== SLUT HELTEPROFIL DEBUG ==========\n");
  } else if (debugRomance) {
    debugLog("Efter focusAllowsSource (merged):", merged.length);
    const afterSelect = selectValuableSources(
      merged.map((m) => ({ ...m, batch: batchLabel }))
    );
    debugLog("Efter selectValuableSources:", afterSelect.length);
    debugLog("--- slut romanceprofil debug ---\n");
  }
  // === SLUT MIDLERTIDIG DEBUG ===

  const usage = response.usage || {};
  return {
    id,
    focus,
    batch: batchLabel,
    query,
    findings: merged,
    rawUrlCount: rawUrls.length,
    webSearchCalls: countWebSearchCalls(response),
    inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
    outputTokens: usage.output_tokens || usage.completion_tokens || 0,
  };
}

function hostnameTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Kilde";
  }
}

function findingsToSourceDrafts(searchResults) {
  const drafts = [];
  for (const sr of searchResults) {
    for (const f of sr.findings || []) {
      if (!f.url && !f.title) continue;
      drafts.push({
        title: f.title || "Kilde",
        url: f.url || null,
        type: f.type || "other",
        batch: f.batch || sr.batch || sr.focus || null,
        summary: f.summary || "",
        focus: sr.focus,
      });
    }
  }
  return normalizeSources(drafts);
}

function buildSynthesisPrompt({
  identity,
  catalog,
  mofibo,
  sources,
  searchResults,
}) {
  return `Du syntetiserer bog-research til JSON. Du må IKKE søge på nettet.
Brug KUN de medsendte findings/kilder + katalog/Mofibo.

Identitet:
${JSON.stringify(identity, null, 2)}

Katalog:
${JSON.stringify(catalog || {}, null, 2)}

Mofibo:
${JSON.stringify(mofibo || {}, null, 2)}

Rå søgeresultater:
${JSON.stringify(searchResults, null, 2)}

Normaliserede kilder (brug disse id'er i consensus):
${JSON.stringify(sources, null, 2)}

Regler:
1) Bekræft titel+forfatter. Match ikke på titel alene.
2) Fakta kun når understøttet; ellers not_verified / null.
3) Goodreads kun hvis titel OG forfatter matcher; ellers null. OL/Google Books ≠ Goodreads.
4) Kilder er batchet: helteprofil (MMC/relation), romanceprofil (spice/romance),
   plotkarakter (plot/udvikling), helhed (læseoplevelse/serie). Behold sources[].batch.
5) Formålet er indsigt i romantasy-tropes og læseoplevelse. Branchenyheder/lore tæller ikke.
6) Forhandlertekst og forlags-PR er ikke uafhængig anmeldelse — brug dem ALDRIG i supportingSourceIds.
7) Udled reviewConsensus for Tine-relevante temaer (også fravær):
   romancefokus, slowBurn, spice, enemiesToLovers, friendsToLovers, forcedProximity,
   relationType, protective, possessiveness, touchHerAndDie, rhysandLikeTraits,
   politicalIntrigue, warMilitary, worldbuilding, magicSystem, pacing, cliffhangers,
   emotionalIntensity, characterGrowth, epicPlot.
8) Hver finding i reviewConsensus skal sige noget konkret om bogen (ikke salgstal/PR).
9) Behold sources som givet (samme id'er + batch). Opdig ikke nye URL'er.
10) Når kilder modsiger hinanden: sæt conflictingSourceIds og consensus "mixed".
11) supportingSourceIds/conflictingSourceIds må KUN bruge id'er fra den medsendte sourceliste.

Returnér KUN JSON med identity, facts, ratings.goodreads, reviewConsensus, sources (samme id'er), researchedAt (ISO).
reviewConsensus.*.supportingSourceIds / conflictingSourceIds: string[]
sources.type: professional|blog|forum|goodreads|wikipedia|official|publisher|catalog|other
sources.batch: helteprofil|romanceprofil|plotkarakter|helhed`;
}

async function createOpenAIClient(apiKey) {
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey });
}

async function synthesizeResearch(client, args) {
  const prompt = buildSynthesisPrompt(args);
  const completion = await client.chat.completions.create({
    model: RESEARCH_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Du er research-syntetiserer. Ingen web search. Professionelle anmeldelser > blogs > fora. Svar kun med JSON.",
      },
      { role: "user", content: prompt },
    ],
  });
  const text = completion.choices?.[0]?.message?.content;
  const parsed = extractJson(text);
  // Behold vores normaliserede kilde-id'er hvis modellen glemmer dem
  if (!Array.isArray(parsed.sources) || parsed.sources.length < args.sources.length) {
    parsed.sources = args.sources;
  } else {
    parsed.sources = normalizeSources(parsed.sources);
  }
  return {
    parsed,
    inputTokens: completion.usage?.prompt_tokens || 0,
    outputTokens: completion.usage?.completion_tokens || 0,
    model: completion.model || RESEARCH_MODEL,
  };
}

/**
 * Fase A: 4 faste web_search-batches + syntese uden search.
 */
export async function runWebResearch({ identity, catalog, mofibo }) {
  const key = getOpenAIKey();
  if (!key) {
    const research = emptyResearch(identity);
    research.meta.warnings.push("missing_api_key");
    return { research, usage: research.meta };
  }

  const client = await createOpenAIClient(key);
  try {
    fsWriteClearDebug();
  } catch {}
  const plan = buildSearchPlan(identity);
  let inputTokens = 0;
  let outputTokens = 0;
  let webSearchCalls = 0;
  const searchResults = [];
  const warnings = [];

  for (const step of plan) {
    try {
      const result = await runFocusedSearch(client, step);
      searchResults.push(result);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      webSearchCalls += result.webSearchCalls;
      debugLog(
        `Research-søgning [${step.id}]: ${result.findings.length} findings (rå URL'er: ${result.rawUrlCount || 0})`
      );
    } catch (err) {
      console.warn(`Research-søgning [${step.id}] fejlede:`, err.message);
      warnings.push(`${step.id}: ${err.message}`);
      searchResults.push({
        id: step.id,
        focus: step.focus,
        query: step.query,
        findings: [],
        webSearchCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
  }

  const sources = findingsToSourceDrafts(searchResults);

  // === MIDLERTIDIG DEBUG: batch-tal efter global selectValuableSources ===
  const byBatch = (b) => sources.filter((s) => s.batch === b).length;
  debugLog("\n========== BATCH-TAL EFTER GLOBAL FILTER ==========");
  debugLog("helteprofil:", byBatch("helteprofil"));
  debugLog("romanceprofil:", byBatch("romanceprofil"));
  debugLog("plotkarakter:", byBatch("plotkarakter"));
  debugLog("helhed:", byBatch("helhed"));
  debugLog("total:", sources.length);
  for (const sr of searchResults) {
    if (sr.id === "helteprofil" || sr.id === "romanceprofil") {
      debugLog(
        `  step[${sr.id}] merged findings ind: ${sr.findings?.length || 0}, rå: ${sr.rawUrlCount || 0}`
      );
    }
  }
  debugLog("========== SLUT BATCH-TAL ==========\n");
  // === SLUT MIDLERTIDIG DEBUG ===

  try {
    const synth = await synthesizeResearch(client, {
      identity,
      catalog,
      mofibo,
      sources,
      searchResults,
    });
    inputTokens += synth.inputTokens;
    outputTokens += synth.outputTokens;

    const foundation = summarizeSourceFoundation(sources);
    const partial =
      sources.length < 6 || foundation.reviewLikeSources < 2;

    // Lås batchede kilder — syntesen må ikke blande batches eller smide PR ind igen
    const research = normalizeResearch(synth.parsed, identity, {
      promptVersion: RESEARCH_PROMPT_VERSION,
      model: synth.model,
      webSearchCalls,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        estimateCostUsd(ANALYSIS_MODEL, inputTokens, outputTokens) * 0.5 +
        estimateCostUsd(RESEARCH_MODEL, synth.inputTokens, synth.outputTokens),
      partial,
      warnings,
      searchPlan: plan.map((p) => p.id),
      foundation,
      lockedSources: sources,
    });

    if (research.meta.partial && !research.meta.warnings.some((w) => w.includes("tyndere"))) {
      research.meta.warnings.push(
        "Fandt færre anmeldelser end ønsket — vurderingen bygger på et tyndere udvalg."
      );
    }

    debugLog(
      `Webresearch: ${research.identity.title} · kilder=${research.sources.length} · pro=${research.meta.foundation?.professionalReviews || 0} · blog=${research.meta.foundation?.reviewsOrBlogs || 0} · web_search=${webSearchCalls}`
    );
    return { research, usage: research.meta };
  } catch (err) {
    console.error("Webresearch syntese fejl:", err.message);
    const research = emptyResearch(identity);
    research.sources = sources;
    research.meta.warnings.push(...warnings, err.message);
    research.meta.partial = true;
    research.meta.webSearchCalls = webSearchCalls;
    research.meta.inputTokens = inputTokens;
    research.meta.outputTokens = outputTokens;
    research.meta.searchPlan = plan.map((p) => p.id);
    research.meta.foundation = summarizeSourceFoundation(sources);
    if (catalog?.description) {
      research.facts.officialDescription = {
        value: String(catalog.description).slice(0, 500),
        status: "partially_verified",
        confidence: "low",
        sourceIds: [],
      };
    }
    return { research, usage: research.meta, error: err.message };
  }
}

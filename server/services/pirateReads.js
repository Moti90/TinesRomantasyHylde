/**
 * PirateReads (Goodreads-hylder via api.piratereads.com).
 * Bruges til discovery-filter og anmeldelsessøgning.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dataPath, getDataDir } from "./paths.js";
import { authorMatch, titleSimilarity } from "./identify.js";

const DATA_DIR = getDataDir();
const CACHE_PATH = dataPath("piratereads-cache.json");
const CONFIG_PATH = dataPath("config.json");

const API_BASE = "https://api.piratereads.com";
const SHELVES = ["read", "currently-reading", "want-to-read"];
const PAGE_SIZE = 100;
const CACHE_DAYS = Number(process.env.PIRATEREADS_CACHE_DAYS || 1);

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function getPirateReadsUserId() {
  const cfg = readConfig();
  return (
    String(cfg.pirateReadsUserId || process.env.PIRATEREADS_USER_ID || "155251530").trim()
  );
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

/** Normalisér titel til sammenligning. */
export function normalizeBookKey(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9æøå\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip "Title (Series, #1)" → { bare, series }.
 */
export function splitGoodreadsTitle(bookTitle) {
  const raw = String(bookTitle || "").trim();
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) {
    return { bare: raw, series: null };
  }
  const bare = m[1].trim();
  // "Mages of the Wheel, #1" → series name before comma/#
  const series = m[2]
    .replace(/,?\s*#\s*\d+(\.\d+)?\s*$/i, "")
    .replace(/\s+#\d+(\.\d+)?\s*$/i, "")
    .trim();
  return { bare, series: series || null };
}

export function isExcludedReviewBook(book) {
  const { bare, series } = splitGoodreadsTitle(book?.book_title);
  return [book?.book_title, bare, series].some((value) =>
    /harry\s+potter/i.test(String(value || ""))
  );
}

export function mapPirateReadsBookForReview(book) {
  const { bare, series } = splitGoodreadsTitle(book?.book_title);
  const author = String(book?.book_author || "").trim();
  const fullTitle = String(book?.book_title || "").trim();
  const goodreadsUrl = book?.book_link || null;
  const sourceBookId =
    goodreadsUrl ||
    `${normalizeBookKey(fullTitle)}||${normalizeBookKey(author)}`;
  return {
    sourceBookId,
    source: "piratereads",
    displayTitle: fullTitle || bare,
    seriesName: series || bare,
    firstBookTitle: bare,
    author,
    status: "Læst",
    goodreadsUrl,
  };
}

function authorKey(author) {
  return normalizeBookKey(author).split(" ").filter(Boolean).slice(-1)[0] || "";
}

/**
 * Byg opslagsindeks fra PirateReads-bøger.
 */
export function buildPirateReadsIndex(books) {
  const titles = new Set();
  const series = new Set();
  const titleAuthor = new Set();

  for (const b of books || []) {
    const { bare, series: seriesName } = splitGoodreadsTitle(b.book_title);
    const tBare = normalizeBookKey(bare);
    const tFull = normalizeBookKey(b.book_title);
    const a = authorKey(b.book_author);
    if (tBare) {
      titles.add(tBare);
      if (a) titleAuthor.add(`${tBare}||${a}`);
    }
    if (tFull) titles.add(tFull);
    if (seriesName) {
      const s = normalizeBookKey(seriesName);
      if (s) series.add(s);
    }
  }

  return { titles, series, titleAuthor, count: (books || []).length };
}

/**
 * Matcher discovery-kandidat mod PirateReads-indeks.
 */
export function matchesPirateReads(candidate, index) {
  if (!index || !candidate?.title) return false;
  const title = normalizeBookKey(candidate.title);
  const { bare, series } = splitGoodreadsTitle(candidate.title);
  const bareKey = normalizeBookKey(bare);
  const a = authorKey(candidate.author);

  if (title && index.titles.has(title)) return true;
  if (bareKey && index.titles.has(bareKey)) return true;
  if (series) {
    const s = normalizeBookKey(series);
    if (s && index.series.has(s)) return true;
  }
  // Serie-navn som discovery-titel (fx "Mages of the Wheel")
  if (title && index.series.has(title)) return true;
  if (bareKey && index.series.has(bareKey)) return true;

  if (a && bareKey && index.titleAuthor.has(`${bareKey}||${a}`)) return true;
  return false;
}

async function fetchShelfPage(userId, shelf, page) {
  const url = `${API_BASE}/${encodeURIComponent(userId)}/${shelf}?page=${page}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`PirateReads ${shelf} page ${page}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data.books) ? data.books : [];
}

async function fetchShelfAll(userId, shelf) {
  const all = [];
  let page = 1;
  for (;;) {
    const books = await fetchShelfPage(userId, shelf, page);
    all.push(...books);
    if (books.length < PAGE_SIZE) break;
    page += 1;
    if (page > 50) break; // sikkerhedsloft
  }
  return all;
}

function loadCache() {
  ensureDir();
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveCache(payload) {
  ensureDir();
  writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Hent alle hylder (med cache).
 * @param {{ force?: boolean, userId?: string }} opts
 */
export async function loadPirateReadsLibrary(opts = {}) {
  const userId = opts.userId || getPirateReadsUserId();
  const force = Boolean(opts.force);
  const cache = loadCache();

  if (
    !force &&
    cache &&
    cache.userId === userId &&
    ageDays(cache.fetchedAt) <= CACHE_DAYS &&
    Array.isArray(cache.books)
  ) {
    const index = buildPirateReadsIndex(cache.books);
    return {
      userId,
      fromCache: true,
      fetchedAt: cache.fetchedAt,
      books: cache.books,
      shelves: cache.shelves || {},
      index,
    };
  }

  const shelves = {};
  const books = [];
  const seen = new Set();

  for (const shelf of SHELVES) {
    try {
      console.log(`[piratereads] Henter ${shelf}…`);
      const list = await fetchShelfAll(userId, shelf);
      shelves[shelf] = list.length;
      for (const b of list) {
        const key = `${normalizeBookKey(b.book_title)}||${normalizeBookKey(b.book_author)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        books.push({
          book_title: b.book_title,
          book_author: b.book_author,
          shelf,
          book_link: b.book_link || null,
        });
      }
      console.log(`[piratereads] ${shelf}: ${list.length} bøger`);
    } catch (err) {
      console.warn(`[piratereads] Fejl på ${shelf}:`, err.message);
      shelves[shelf] = { error: err.message };
    }
  }

  const fetchedAt = new Date().toISOString();
  saveCache({ userId, fetchedAt, shelves, books });

  return {
    userId,
    fromCache: false,
    fetchedAt,
    books,
    shelves,
    index: buildPirateReadsIndex(books),
  };
}

/**
 * Filtrér discovery-kandidater der allerede er på PirateReads.
 */
export function filterAgainstPirateReads(candidates, index) {
  if (!index || !Array.isArray(candidates)) {
    return { kept: candidates || [], removed: [], removedCount: 0 };
  }
  const kept = [];
  const removed = [];
  for (const c of candidates) {
    if (matchesPirateReads(c, index)) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed, removedCount: removed.length };
}

function bookNumberFromTitle(bookTitle) {
  const m = String(bookTitle || "").match(/#\s*(\d+(?:\.\d+)?)\s*\)\s*$/);
  return m ? Number(m[1]) : null;
}

function toReviewCandidate(book, extras = {}) {
  const { bare, series } = splitGoodreadsTitle(book.book_title);
  const author = String(book.book_author || "").trim() || null;
  const bookNumber = bookNumberFromTitle(book.book_title);
  return {
    title: bare || String(book.book_title || "").trim() || null,
    author,
    series: series || null,
    bookNumber,
    year: null,
    source: extras.source || "Goodreads",
    identityConfidence: extras.identityConfidence || "high",
    goodreadsUrl: book.book_link || null,
    shelf: book.shelf || null,
  };
}

function toReviewIdentity(book) {
  const c = toReviewCandidate(book);
  return {
    title: c.title,
    author: c.author,
    series: c.series,
    bookNumber: c.bookNumber,
    identityConfidence: "high",
    goodreadsUrl: c.goodreadsUrl,
    source: "piratereads",
  };
}

/**
 * Søg i Tines Goodreads-hylder (via PirateReads) efter bog/serie/forfatter.
 * Matcher serienavne i parentes — det OL/Google Books ofte mangler.
 */
export function searchPirateReadsForReview(
  books,
  { query = "", author = "" } = {}
) {
  const q = String(query || "").trim();
  const authorHint = String(author || "").trim();
  if (!q && !authorHint) return null;

  const authorOnly = !q && Boolean(authorHint);
  const scored = [];

  for (const book of books || []) {
    // Udeluk HP-lignende støj på hylderne — men hvis brugeren eksplicit søger
    // efter dem, skal serien stadig kunne findes (parentes-serienavn).
    if (isExcludedReviewBook(book)) {
      const { bare, series } = splitGoodreadsTitle(book.book_title);
      const targetsQuery =
        q &&
        [book.book_title, bare, series].some(
          (value) => titleSimilarity(value, q) >= 0.7
        );
      if (!targetsQuery) continue;
    }
    const { bare, series } = splitGoodreadsTitle(book.book_title);
    const rowAuthor = String(book.book_author || "").trim();
    const seriesScore = q && series ? titleSimilarity(series, q) : 0;
    const titleScore = q ? titleSimilarity(bare || book.book_title, q) : 0;
    const fullScore = q ? titleSimilarity(book.book_title, q) : 0;
    const a = authorMatch(rowAuthor, authorHint || null);
    let score;
    if (authorOnly) {
      score = a.score;
      if (!a.matched) score = 0;
    } else {
      const bestText = Math.max(seriesScore, titleScore, fullScore);
      score =
        bestText * (authorHint ? 0.6 : 0.85) +
        a.score * (authorHint ? 0.4 : 0.15);
      if (seriesScore >= 0.7) score = Math.max(score, 0.88 + a.score * 0.1);
      if (authorHint && !a.matched && bestText < 0.95) score *= 0.3;
    }
    // Læste bøger først — det er dem anmeldelser typisk handler om
    if (book.shelf === "read") score += 0.03;
    if (score >= (authorOnly ? 0.75 : 0.55)) {
      scored.push({ book, score, seriesScore, titleScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;

  // Dedup: én kandidat pr. serie (eller pr. bogtitel hvis standalone)
  const seen = new Set();
  const unique = [];
  for (const row of scored) {
    const { bare, series } = splitGoodreadsTitle(row.book.book_title);
    const key = series
      ? `series|${normalizeBookKey(series)}|${normalizeBookKey(row.book.book_author)}`
      : `book|${normalizeBookKey(bare)}|${normalizeBookKey(row.book.book_author)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const asCandidate = (row) => toReviewCandidate(row.book);

  if (authorOnly) {
    return {
      status: "ambiguous",
      candidates: unique.slice(0, 8).map(asCandidate),
      userMessage:
        "Flere bøger/serier på Tines Goodreads. Vælg den rigtige.",
    };
  }

  const top = unique[0];
  if (top.seriesScore >= 0.7) {
    return {
      status: "identified",
      identity: toReviewIdentity(top.book),
      candidates: unique.slice(0, 5).map(asCandidate),
    };
  }

  const rivals = unique.filter(
    (x, i) =>
      i > 0 &&
      x.score >= 0.7 &&
      Math.abs(x.score - top.score) < 0.12
  );
  if (rivals.length || (authorOnly === false && unique.length > 1 && top.score < 0.85)) {
    // Ved usikkerhed: lad brugeren vælge blandt Goodreads-hits
    if (rivals.length || top.score < 0.8) {
      return {
        status: "ambiguous",
        candidates: unique.slice(0, 6).map(asCandidate),
        userMessage: "Flere Goodreads-bøger matcher. Vælg den rigtige.",
      };
    }
  }

  if (top.score >= 0.7) {
    return {
      status: "identified",
      identity: toReviewIdentity(top.book),
      candidates: unique.slice(0, 5).map(asCandidate),
    };
  }

  return null;
}

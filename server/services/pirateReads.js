/**
 * PirateReads (Goodreads-hylder via api.piratereads.com).
 * Bruges til at filtrere discovery-kandidater fra Tines læste / TBR / læser-nu.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const CACHE_PATH = join(DATA_DIR, "piratereads-cache.json");
const CONFIG_PATH = join(DATA_DIR, "config.json");

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

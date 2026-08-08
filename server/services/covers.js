/**
 * Cover-opslag via Open Library (+ Google Books fallback).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dataPath, getDataDir } from "./paths.js";

const CACHE_PATH = dataPath("cover-cache.json");
const UA = "TineRomantasyListe/1.0 (local; covers)";

function ensureDataDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cacheKey(title, author = "") {
  return `${norm(title)}|${norm(author)}`;
}

function loadCache() {
  try {
    if (!existsSync(CACHE_PATH)) return {};
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  ensureDataDir();
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function olCoverFromDoc(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.cover_i) {
    return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }
  const isbn = Array.isArray(doc.isbn) ? doc.isbn[0] : null;
  if (isbn) {
    return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  }
  return null;
}

async function lookupOpenLibrary(title, author) {
  const params = new URLSearchParams({
    title: String(title || "").trim(),
    limit: "5",
  });
  if (author) params.set("author", String(author).trim());
  const data = await fetchJson(
    `https://openlibrary.org/search.json?${params.toString()}`
  );
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  for (const doc of docs) {
    const url = olCoverFromDoc(doc);
    if (url) return url;
  }
  return null;
}

async function lookupGoogleBooks(title, author) {
  const q = author
    ? `intitle:${title} inauthor:${author}`
    : `intitle:${title}`;
  const data = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      q
    )}&maxResults=3`
  );
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items) {
    const links = item?.volumeInfo?.imageLinks || {};
    const raw =
      links.thumbnail || links.smallThumbnail || links.small || links.medium;
    if (!raw) continue;
    return String(raw).replace(/^http:\/\//i, "https://");
  }
  return null;
}

/**
 * @returns {Promise<string|null>}
 */
export async function lookupCoverUrl(title, author = null) {
  const t = String(title || "").trim();
  if (!t) return null;
  const a = String(author || "").trim() || null;
  const key = cacheKey(t, a || "");
  const cache = loadCache();
  if (Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key] || null;
  }

  let url = null;
  try {
    url = await lookupOpenLibrary(t, a);
  } catch (err) {
    console.warn("[covers] Open Library:", err.message);
  }
  if (!url) {
    try {
      url = await lookupGoogleBooks(t, a);
    } catch (err) {
      console.warn("[covers] Google Books:", err.message);
    }
  }

  cache[key] = url;
  saveCache(cache);
  return url;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * Tilføj coverUrl på kandidater. Gemmer også i cover-cache.
 * @returns {{ list: object[], updated: number }}
 */
export async function enrichWithCovers(candidates, { concurrency = 4 } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let updated = 0;
  await mapPool(list, concurrency, async (c) => {
    if (!c || c.coverUrl) return c;
    const url = await lookupCoverUrl(c.title, c.author);
    if (url) {
      c.coverUrl = url;
      updated += 1;
    }
    return c;
  });
  return { list, updated };
}

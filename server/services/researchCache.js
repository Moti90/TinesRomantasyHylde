import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { researchInputHash } from "./hash.js";
import {
  RESEARCH_CACHE_DAYS,
  GOODREADS_CACHE_DAYS,
} from "./versions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(__dirname, "../../data/research-cache");

function ensureDir() {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
}

function pathFor(hash) {
  return join(cacheDir, `${hash}.json`);
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

export function getCachedResearch(identity) {
  ensureDir();
  const hash = researchInputHash(identity);
  const file = pathFor(hash);
  if (!existsSync(file)) return { hit: false, hash, research: null };

  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const researchedAt = data?.researchedAt || data?.savedAt;
    if (ageDays(researchedAt) > RESEARCH_CACHE_DAYS) {
      return { hit: false, hash, research: null, reason: "expired" };
    }

    // Goodreads-del kan være ældre — marker partial stale
    const gr = data?.ratings?.goodreads;
    const goodreadsStale =
      gr?.fetchedAt && ageDays(gr.fetchedAt) > GOODREADS_CACHE_DAYS;

    return {
      hit: true,
      hash,
      research: data,
      goodreadsStale: Boolean(goodreadsStale),
    };
  } catch {
    return { hit: false, hash, research: null, reason: "corrupt" };
  }
}

export function saveResearchCache(identity, research) {
  ensureDir();
  const hash = researchInputHash(identity);
  const payload = {
    ...research,
    _cacheKey: hash,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(pathFor(hash), JSON.stringify(payload, null, 2), "utf8");
  return hash;
}

export function clearResearchCache() {
  ensureDir();
  for (const f of readdirSync(cacheDir)) {
    if (f.endsWith(".json")) unlinkSync(join(cacheDir, f));
  }
}

export function getCacheDir() {
  return cacheDir;
}

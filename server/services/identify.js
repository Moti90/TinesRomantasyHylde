/**
 * Bogidentifikation via Open Library + Google Books.
 * Matcher titel+forfatter når muligt. Returnerer kandidater ved tvetydighed.
 */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "TineRomantasyListe/1.0 (local; identify)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå\s&]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

function authorMatch(candidateAuthors, hint) {
  if (!hint) return { matched: false, score: 0.5 };
  const nh = norm(hint);
  const list = Array.isArray(candidateAuthors)
    ? candidateAuthors
    : [candidateAuthors];
  for (const a of list) {
    const na = norm(a);
    if (!na) continue;
    if (na === nh || na.includes(nh) || nh.includes(na)) {
      return { matched: true, score: 1 };
    }
    const parts = nh.split(" ").filter((p) => p.length > 2);
    if (parts.length && parts.every((p) => na.includes(p))) {
      return { matched: true, score: 0.9 };
    }
  }
  return { matched: false, score: 0.15 };
}

function toCandidate(raw) {
  return {
    title: raw.title || null,
    author: Array.isArray(raw.authors)
      ? raw.authors[0] || null
      : raw.author || null,
    authors: raw.authors || (raw.author ? [raw.author] : []),
    series: raw.series || null,
    bookNumber: raw.bookNumber ?? null,
    isbn: raw.isbn || null,
    source: raw.source || null,
    year: raw.year || null,
    identityConfidence: raw.identityConfidence || "medium",
  };
}

async function searchOpenLibrary(query) {
  const ol = await fetchJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8`
  );
  return (ol?.docs || []).map((doc) =>
    toCandidate({
      title: doc.title,
      authors: doc.author_name || [],
      year: doc.first_publish_year || null,
      isbn: doc.isbn?.[0] || null,
      source: "Open Library",
      series: Array.isArray(doc.series) ? doc.series[0] : doc.series || null,
    })
  );
}

async function searchGoogleBooks(query) {
  const gb = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8`
  );
  return (gb?.items || []).map((item) => {
    const v = item.volumeInfo || {};
    const isbn =
      (v.industryIdentifiers || []).find((i) => i.type?.includes("ISBN"))
        ?.identifier || null;
    return toCandidate({
      title: v.title,
      authors: v.authors || [],
      year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) : null,
      isbn,
      source: "Google Books",
      series: v.seriesInfo?.bookDisplayNumber
        ? v.subtitle || null
        : null,
    });
  });
}

function scoreCandidate(c, queryTitle, authorHint) {
  const tScore = titleSimilarity(c.title, queryTitle);
  const a = authorMatch(c.authors, authorHint);
  let score = tScore * (authorHint ? 0.55 : 0.75) + a.score * (authorHint ? 0.45 : 0.25);
  if (authorHint && !a.matched && tScore < 0.95) score *= 0.35;
  return { ...c, _score: score, _authorMatched: a.matched };
}

function confidenceFromScore(score, authorMatched, authorHint) {
  if (score >= 0.85 && (!authorHint || authorMatched)) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

/**
 * @param {{ query: string, author?: string }} opts
 * @returns {Promise<{
 *   status: 'identified'|'ambiguous'|'not_found',
 *   identity?: object,
 *   candidates?: object[],
 *   catalog?: object
 * }>}
 */
export async function identifyBook({ query, author = "" }) {
  const q = String(query || "").trim();
  const authorHint = String(author || "").trim();
  if (!q) return { status: "not_found", candidates: [] };

  // Tillad "Titel — Forfatter" / "Titel by Forfatter"
  let titlePart = q;
  let parsedAuthor = authorHint;
  const byMatch = q.match(/^(.+?)\s+(?:—|–|-|by|af)\s+(.+)$/i);
  if (byMatch && !authorHint) {
    titlePart = byMatch[1].trim();
    parsedAuthor = byMatch[2].trim();
  }

  const searchQ = parsedAuthor ? `${titlePart} ${parsedAuthor}` : titlePart;

  let candidates = [];
  try {
    const [ol, gb] = await Promise.all([
      searchOpenLibrary(searchQ),
      searchGoogleBooks(searchQ),
    ]);
    candidates = [...ol, ...gb];
  } catch (err) {
    console.warn("identify: katalogfejl", err.message);
  }

  // Dedup på titel+forfatter
  const seen = new Map();
  for (const c of candidates) {
    const key = `${norm(c.title)}|${norm(c.author)}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  const unique = [...seen.values()].map((c) =>
    scoreCandidate(c, titlePart, parsedAuthor)
  );
  unique.sort((a, b) => b._score - a._score);

  if (!unique.length) {
    return {
      status: "not_found",
      identity: {
        title: titlePart,
        author: parsedAuthor || null,
        series: null,
        bookNumber: null,
        identityConfidence: "low",
      },
      candidates: [],
    };
  }

  const top = unique[0];
  const second = unique[1];
  const topConf = confidenceFromScore(
    top._score,
    top._authorMatched,
    parsedAuthor
  );

  // Tvetydighed: flere høje scorer med forskellige forfattere
  const rivals = unique.filter(
    (c) =>
      c !== top &&
      c._score >= 0.55 &&
      norm(c.author) !== norm(top.author) &&
      titleSimilarity(c.title, top.title) >= 0.7
  );

  if (rivals.length && !parsedAuthor && topConf !== "high") {
    return {
      status: "ambiguous",
      candidates: [top, ...rivals].slice(0, 5).map((c) => ({
        title: c.title,
        author: c.author,
        series: c.series,
        bookNumber: c.bookNumber,
        year: c.year,
        source: c.source,
        identityConfidence: confidenceFromScore(
          c._score,
          c._authorMatched,
          parsedAuthor
        ),
      })),
    };
  }

  const identity = {
    title: top.title || titlePart,
    author: top.author || parsedAuthor || null,
    series: top.series || null,
    bookNumber: top.bookNumber ?? null,
    isbn: top.isbn || null,
    identityConfidence: topConf,
  };

  return {
    status: "identified",
    identity,
    candidates: unique.slice(0, 5).map((c) => ({
      title: c.title,
      author: c.author,
      series: c.series,
      year: c.year,
      source: c.source,
    })),
    catalog: {
      openLibraryHits: unique.filter((c) => c.source === "Open Library").length,
      googleHits: unique.filter((c) => c.source === "Google Books").length,
    },
  };
}

export { norm, titleSimilarity, authorMatch, scoreCandidate };

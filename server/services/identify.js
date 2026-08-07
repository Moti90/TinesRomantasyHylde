/**
 * Bogidentifikation via Open Library + Google Books.
 * Matcher titel, serienavn og forfatter. Returnerer kandidater ved tvetydighed.
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
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
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

/**
 * Udled serienavn + bognummer fra titel/undertitel.
 * Understøtter fx:
 * - Mist's Edge (The Broken Lands, #2)
 * - Mist's Edge (Broken Lands #2)
 * - The Broken Lands, Book 2
 * - Book 2 of The Broken Lands
 */
export function extractSeriesFromText(title, subtitle = null) {
  const rawTitle = String(title || "").trim();
  const rawSub = String(subtitle || "").trim();
  let bare = rawTitle;
  let series = null;
  let bookNumber = null;

  const paren = rawTitle.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    bare = paren[1].trim() || rawTitle;
    const inside = paren[2].trim();
    const numbered = inside.match(
      /^(.*?)(?:,\s*)?(?:#|book|nr\.?|no\.?)\s*(\d+(?:\.\d+)?)\s*$/i
    );
    if (numbered) {
      series = numbered[1].replace(/,\s*$/, "").trim() || null;
      bookNumber = Number(numbered[2]);
    } else if (!/^\d+$/.test(inside)) {
      series = inside;
    }
  }

  const fromSub =
    rawSub.match(/^(.*?)(?:,\s*)?(?:book|nr\.?|#)\s*(\d+(?:\.\d+)?)\s*$/i) ||
    rawSub.match(/^book\s*(\d+(?:\.\d+)?)\s+of\s+(.+)$/i);
  if (!series && fromSub) {
    if (fromSub[2] && /book|nr\.?|#/i.test(rawSub) && !/^book\s*\d/i.test(rawSub)) {
      series = fromSub[1].trim();
      bookNumber = Number(fromSub[2]);
    } else if (/^book\s*\d/i.test(rawSub)) {
      bookNumber = Number(fromSub[1]);
      series = String(fromSub[2] || "").trim() || null;
    } else {
      series = fromSub[1].trim();
      bookNumber = Number(fromSub[2]);
    }
  }

  if (!series && rawSub && !/^\d+$/.test(rawSub) && rawSub.length > 2) {
    // Undertitel kan være serienavn alene
    if (!/edition|omnibus|collector|volume/i.test(rawSub)) {
      series = rawSub;
    }
  }

  return {
    bare: bare || rawTitle || null,
    series: series || null,
    bookNumber: Number.isFinite(bookNumber) ? bookNumber : null,
  };
}

function toCandidate(raw) {
  const extracted = extractSeriesFromText(raw.title, raw.subtitle || null);
  const series =
    raw.series ||
    extracted.series ||
    null;
  return {
    title: extracted.bare || raw.title || null,
    rawTitle: raw.title || null,
    author: Array.isArray(raw.authors)
      ? raw.authors[0] || null
      : raw.author || null,
    authors: raw.authors || (raw.author ? [raw.author] : []),
    series,
    bookNumber: raw.bookNumber ?? extracted.bookNumber ?? null,
    isbn: raw.isbn || null,
    source: raw.source || null,
    year: raw.year || null,
    identityConfidence: raw.identityConfidence || "medium",
  };
}

async function searchOpenLibrary(query, { authorOnly = false } = {}) {
  const url = authorOnly
    ? `https://openlibrary.org/search.json?author=${encodeURIComponent(query)}&limit=12`
    : `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=12`;
  const ol = await fetchJson(url);
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

async function searchGoogleBooks(query, { authorOnly = false } = {}) {
  const q = authorOnly ? `inauthor:"${query}"` : query;
  const gb = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12`
  );
  return (gb?.items || []).map((item) => {
    const v = item.volumeInfo || {};
    const isbn =
      (v.industryIdentifiers || []).find((i) => i.type?.includes("ISBN"))
        ?.identifier || null;
    return toCandidate({
      title: v.title,
      subtitle: v.subtitle || null,
      authors: v.authors || [],
      year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) : null,
      isbn,
      source: "Google Books",
      series: v.seriesInfo?.volumeSeries?.[0]?.seriesId || null,
    });
  });
}

function scoreCandidate(c, queryTitle, authorHint, { authorOnly = false } = {}) {
  const tScore = titleSimilarity(c.title, queryTitle);
  const seriesScore = titleSimilarity(c.series, queryTitle);
  const bestTextScore = Math.max(tScore, seriesScore);
  const a = authorMatch(c.authors, authorHint);

  let score;
  if (authorOnly) {
    score = a.score * 0.75 + bestTextScore * 0.25;
    if (!a.matched) score *= 0.25;
  } else {
    score =
      bestTextScore * (authorHint ? 0.55 : 0.75) +
      a.score * (authorHint ? 0.45 : 0.25);
    // Beløn treffere hvor søgestrengen matcher serienavnet
    if (seriesScore >= 0.7) score = Math.max(score, 0.72 + a.score * 0.2);
    if (authorHint && !a.matched && bestTextScore < 0.95) score *= 0.35;
  }

  return {
    ...c,
    _score: score,
    _authorMatched: a.matched,
    _seriesMatched: seriesScore >= 0.7,
    _titleMatched: tScore >= 0.7,
  };
}

function confidenceFromScore(score, authorMatched, authorHint) {
  if (score >= 0.85 && (!authorHint || authorMatched)) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function publicCandidate(c, parsedAuthor) {
  return {
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
  };
}

function chooseSeriesName(candidates, queryTitle) {
  const counts = new Map();
  for (const c of candidates) {
    if (!c.series) continue;
    const key = norm(c.series);
    if (!key) continue;
    const prev = counts.get(key) || { name: c.series, count: 0, score: 0 };
    prev.count += 1;
    prev.score += c._score || 0;
    if (titleSimilarity(c.series, queryTitle) > titleSimilarity(prev.name, queryTitle)) {
      prev.name = c.series;
    }
    counts.set(key, prev);
  }
  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || b.score - a.score
  );
  if (!ranked.length) return null;
  const best = ranked[0];
  // Hvis søgningen matcher et serienavn, foretræk det
  const queryMatch = ranked.find((row) => titleSimilarity(row.name, queryTitle) >= 0.7);
  return (queryMatch || best).name;
}

function buildIdentityFromCandidates(unique, queryTitle, parsedAuthor, authorOnly) {
  const top = unique[0];
  const seriesName = chooseSeriesName(unique.slice(0, 8), queryTitle);
  const seriesMatched =
    Boolean(seriesName) &&
    (titleSimilarity(seriesName, queryTitle) >= 0.7 ||
      unique.some((c) => c._seriesMatched && norm(c.series) === norm(seriesName)));

  // Serienavn-søgning eller tydelig serie i topresultater → serie-identitet
  if (seriesName && (seriesMatched || (!authorOnly && seriesName && top.series))) {
    const seriesBooks = unique.filter(
      (c) => c.series && norm(c.series) === norm(seriesName)
    );
    const seed = seriesBooks[0] || top;
    return {
      title: seed.title || queryTitle,
      author: seed.author || parsedAuthor || null,
      series: seriesName,
      bookNumber: seed.bookNumber ?? null,
      isbn: seed.isbn || null,
      identityConfidence: confidenceFromScore(
        seed._score,
        seed._authorMatched,
        parsedAuthor
      ),
    };
  }

  return {
    title: top.title || queryTitle,
    author: top.author || parsedAuthor || null,
    series: top.series || null,
    bookNumber: top.bookNumber ?? null,
    isbn: top.isbn || null,
    identityConfidence: confidenceFromScore(
      top._score,
      top._authorMatched,
      parsedAuthor
    ),
  };
}

/**
 * @param {{ query?: string, author?: string }} opts
 */
export async function identifyBook({ query = "", author = "" } = {}) {
  const q = String(query || "").trim();
  const authorHint = String(author || "").trim();
  const authorOnly = !q && Boolean(authorHint);
  if (!q && !authorHint) return { status: "not_found", candidates: [] };

  let titlePart = q;
  let parsedAuthor = authorHint;
  const byMatch = q.match(/^(.+?)\s+(?:—|–|-|by|af)\s+(.+)$/i);
  if (byMatch && !authorHint) {
    titlePart = byMatch[1].trim();
    parsedAuthor = byMatch[2].trim();
  }

  const searchQ = authorOnly
    ? parsedAuthor
    : parsedAuthor
      ? `${titlePart} ${parsedAuthor}`
      : titlePart;

  let candidates = [];
  try {
    const [ol, gb] = await Promise.all([
      searchOpenLibrary(searchQ, { authorOnly }),
      searchGoogleBooks(searchQ, { authorOnly }),
    ]);
    candidates = [...ol, ...gb];
  } catch (err) {
    console.warn("identify: katalogfejl", err.message);
  }

  const seen = new Map();
  for (const c of candidates) {
    const key = `${norm(c.title)}|${norm(c.author)}|${norm(c.series)}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  const unique = [...seen.values()]
    .map((c) =>
      scoreCandidate(c, titlePart || c.title || "", parsedAuthor, { authorOnly })
    )
    .sort((a, b) => b._score - a._score);

  if (!unique.length) {
    return {
      status: "not_found",
      identity: {
        title: titlePart || null,
        author: parsedAuthor || null,
        series: null,
        bookNumber: null,
        identityConfidence: "low",
      },
      candidates: [],
    };
  }

  const top = unique[0];
  const topConf = confidenceFromScore(
    top._score,
    top._authorMatched,
    parsedAuthor
  );

  // Forfatter-søgning: lad altid brugeren vælge blandt top-kandidater
  if (authorOnly) {
    // Dedup serier i kandidatlisten, så samme serie ikke fylder 5 pladser
    const seriesSeen = new Set();
    const authorCandidates = [];
    for (const c of unique) {
      if (c._score < 0.4) continue;
      const seriesKey = c.series
        ? `series|${norm(c.series)}|${norm(c.author)}`
        : `book|${norm(c.title)}|${norm(c.author)}`;
      if (seriesSeen.has(seriesKey)) continue;
      seriesSeen.add(seriesKey);
      authorCandidates.push(publicCandidate(c, parsedAuthor));
      if (authorCandidates.length >= 8) break;
    }
    return {
      status: "ambiguous",
      candidates: authorCandidates,
      userMessage: "Flere bøger/serier af forfatteren. Vælg den rigtige.",
    };
  }

  const rivals = unique.filter(
    (c) =>
      c !== top &&
      c._score >= 0.55 &&
      norm(c.author) !== norm(top.author) &&
      Math.max(
        titleSimilarity(c.title, top.title),
        titleSimilarity(c.series, top.series)
      ) >= 0.7
  );

  if (rivals.length && !parsedAuthor && topConf !== "high") {
    return {
      status: "ambiguous",
      candidates: [top, ...rivals].slice(0, 5).map((c) =>
        publicCandidate(c, parsedAuthor)
      ),
    };
  }

  const identity = buildIdentityFromCandidates(
    unique,
    titlePart,
    parsedAuthor,
    authorOnly
  );

  return {
    status: "identified",
    identity,
    candidates: unique.slice(0, 5).map((c) => publicCandidate(c, parsedAuthor)),
    catalog: {
      openLibraryHits: unique.filter((c) => c.source === "Open Library").length,
      googleHits: unique.filter((c) => c.source === "Google Books").length,
    },
  };
}

export { norm, titleSimilarity, authorMatch, scoreCandidate };

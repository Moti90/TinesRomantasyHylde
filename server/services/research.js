/**
 * Opslag via Open Library + Google Books + Wikipedia (uden nøgle).
 * Giver kontekst til scoring — "Relation" (MF/RH) kommer typisk fra AI+håndbog,
 * ikke fra katalogfelter (dem har bibliotekerne sjældent).
 */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "TineRomantasyListe/1.0 (local; book research)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchWikipedia(query, titleHint) {
  const candidates = [titleHint, query].filter(Boolean);
  for (const term of candidates) {
    try {
      const search = await fetchJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          `${term} novel`
        )}&srlimit=3&format=json&origin=*`
      );
      const hit = search?.query?.search?.[0];
      if (!hit?.title) continue;

      const page = await fetchJson(
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(
          hit.title
        )}&format=json&origin=*`
      );
      const pages = page?.query?.pages;
      if (!pages) continue;
      const first = Object.values(pages)[0];
      const extract = first?.extract?.trim();
      if (extract && extract.length > 80) {
        return {
          wikiTitle: first.title || hit.title,
          wikiExtract: extract.slice(0, 1800),
        };
      }
    } catch {
      /* prøv næste */
    }
  }
  return null;
}

export async function researchSeries(query) {
  const q = query.trim();
  const unverified = "Ikke verificeret";
  const result = {
    query: q,
    title: null,
    authors: [],
    description: "",
    subjects: [],
    firstPublishYear: null,
    wikiTitle: null,
    wikiExtract: "",
    sources: [],
  };

  try {
    const ol = await fetchJson(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5`
    );
    const doc = ol?.docs?.[0];
    if (doc) {
      result.title = doc.title || null;
      result.authors = doc.author_name || [];
      result.firstPublishYear = doc.first_publish_year || null;
      result.subjects = (doc.subject || []).slice(0, 16);
      result.sources.push("Open Library");
      if (doc.key) {
        const workKey = doc.key; // fx /works/OL82563W
        const work = await fetchJson(`https://openlibrary.org${workKey}.json`);
        if (work?.description) {
          result.description =
            typeof work.description === "string"
              ? work.description
              : work.description.value || "";
        }
        // Officiel Goodreads-API findes ikke — brug Open Library ratings i stedet
        try {
          const ratings = await fetchJson(
            `https://openlibrary.org${workKey}/ratings.json`
          );
          const avg = ratings?.summary?.average;
          const count = ratings?.summary?.count;
          if (avg != null && Number(count) > 0) {
            result.openLibraryRating = Number(avg);
            result.openLibraryRatingCount = Number(count);
            result.ratingDisplay = `${Number(avg).toFixed(2)} (Open Library, n=${count})`;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const gb = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3`
    );
    const item = gb?.items?.[0]?.volumeInfo;
    if (item) {
      if (!result.title) result.title = item.title || null;
      if (!result.authors.length) result.authors = item.authors || [];
      if (!result.description && item.description) {
        result.description = item.description;
      }
      if (item.categories?.length) {
        result.subjects = [
          ...new Set([...result.subjects, ...item.categories]),
        ].slice(0, 16);
      }
      result.sources.push("Google Books");
      if (item.averageRating) {
        result.googleRating = item.averageRating;
        if (!result.ratingDisplay) {
          const n = item.ratingsCount ? `, n=${item.ratingsCount}` : "";
          result.ratingDisplay = `${item.averageRating} (Google Books${n})`;
        }
      }
      if (item.pageCount) result.pageCount = item.pageCount;
    }
  } catch {
    /* ignore */
  }

  try {
    const wiki = await fetchWikipedia(q, result.title);
    if (wiki) {
      result.wikiTitle = wiki.wikiTitle;
      result.wikiExtract = wiki.wikiExtract;
      result.sources.push("Wikipedia");
      if (!result.description) result.description = wiki.wikiExtract;
    }
  } catch {
    /* ignore */
  }

  return {
    ...result,
    // Katalog-ratings er IKKE Goodreads — hold dem adskilt
    verifiedRating: null,
    unverifiedDefaults: {
      "Er serien på Mofibo? (ja, nej, ikke hele serien)": unverified,
      "Goodreads-score": unverified,
    },
  };
}

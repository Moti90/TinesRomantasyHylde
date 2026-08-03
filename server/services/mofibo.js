/**
 * Best-effort Mofibo/Storytel søgning.
 * Ingen officiel API – forsøger kendte søge-endpoints.
 * Ved tvivl: Ikke verificeret (aldrig automatisk Nej).
 */

async function tryStorytelSearch(query) {
  const urls = [
    `https://www.storytel.com/api/search.action?query=${encodeURIComponent(query)}`,
    `https://www.storytel.com/dk/api/search.action?query=${encodeURIComponent(query)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "TineRomantasyDB/1.0",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const books = data?.books || data?.results || data?.items || [];
      if (!Array.isArray(books) || !books.length) continue;

      const q = query.toLowerCase();
      const match = books.find((b) => {
        const title = (
          b?.book?.name ||
          b?.name ||
          b?.title ||
          b?.abook?.name ||
          ""
        ).toLowerCase();
        return title && (title.includes(q) || q.includes(title.slice(0, 12)));
      });

      if (match) {
        const title =
          match?.book?.name || match?.name || match?.title || query;
        const id = match?.book?.id || match?.id || match?.abook?.id;
        return {
          status: "Ja",
          title,
          link: id
            ? `https://mofibo.com/dk/books/${String(title)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")}-${id}`
            : "https://mofibo.com/dk/books",
          source: "storytel-search",
        };
      }
    } catch {
      /* prøv næste */
    }
  }
  return null;
}

export async function checkMofibo(query) {
  const hit = await tryStorytelSearch(query);
  if (hit) return hit;
  return {
    status: "Ikke verificeret",
    title: null,
    link: `https://mofibo.com/dk/books`,
    source: "none",
  };
}

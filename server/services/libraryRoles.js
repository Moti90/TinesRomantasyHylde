/**
 * Biblioteksroller: Excel-ankre vs. Tines anmeldelser.
 */

/** Fast liste — bruges hvis production-data mangler `_origin`. */
const FALLBACK_ANCHOR_NAMES = new Set(
  [
    "Mages of the Wheel",
    "Hidden Legacy",
    "The Bridge Kingdom",
    "A Court of Thorns and Roses",
    "Order of Scorpions",
    "Villains & Virtues",
    "Kushiel's Legacy",
    "Wraith Kings",
    "The Daevabad Trilogy",
    "The Twelve Houses",
    "The Chronicles of the Wolf Queen",
    "The Empire Trilogy",
    "The Winnowing Flame Trilogy",
    "Dark Olympus",
    "The Redemption Saga",
  ].map((name) =>
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
  )
);

function seriesKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isExcelAnchor(row) {
  if (!row || typeof row !== "object") return false;
  if (row._origin?.type === "excel") return true;
  if (row._scoreReference?.source === "excel") return true;
  const key = seriesKey(row["Seriens navn"]);
  return Boolean(key && FALLBACK_ANCHOR_NAMES.has(key));
}

export function isReviewLinked(row) {
  if (!row || typeof row !== "object") return false;
  if (row._origin?.type === "tine_reviews") return true;
  return Number(row._tineReviews?.count || 0) > 0;
}

/**
 * Tilføj libraryTags til UI (og sørg for _origin på ankre).
 */
export function enrichLibraryRow(row) {
  if (!row || typeof row !== "object") return row;
  const anchor = isExcelAnchor(row);
  const reviewCount = Number(row._tineReviews?.count || 0);
  const review = isReviewLinked(row);
  const tags = [];

  if (anchor) {
    tags.push({
      id: "anchor",
      label: "Anker",
      tone: "excel",
      title:
        "Excel-pejlemærke. Kun her for at fastsætte standardscorer og kalibrere appens smag — ikke fra Tines Anmeldelser.",
    });
  }
  if (review) {
    tags.push({
      id: "review",
      label: reviewCount > 1 ? `Anmeldt (${reviewCount})` : "Fra anmeldelse",
      tone: "review",
      title:
        "Knyttet til Tines Anmeldelser. Scorer fra felter hun kan huske kan synces hertil.",
    });
  }

  const next = { ...row, libraryTags: tags };
  if (anchor && next._origin?.type !== "excel") {
    next._origin = {
      type: "excel",
      label: "Anker · Excel-pejlemærke",
    };
  }
  return next;
}

export function enrichLibrarySeries(list) {
  return (Array.isArray(list) ? list : []).map(enrichLibraryRow);
}

/**
 * Persistér manglende Excel-_origin på ankre.
 * @returns {number} antal opdaterede rækker
 */
export function backfillExcelOrigins(list) {
  let changed = 0;
  const out = (Array.isArray(list) ? list : []).map((row) => {
    if (!isExcelAnchor(row)) return row;
    if (row._origin?.type === "excel") return row;
    changed += 1;
    return {
      ...row,
      _origin: {
        type: "excel",
        label: "Anker · Excel-pejlemærke",
      },
    };
  });
  return { list: out, changed };
}

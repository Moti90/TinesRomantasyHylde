import { researchSeries } from "../server/services/research.js";

for (const q of [
  "Reign and Ruin J.D. Evans",
  "Mages of the Wheel",
  "Reign & Ruin Evans",
]) {
  const r = await researchSeries(q);
  console.log("---", q);
  console.log({
    title: r.title,
    authors: r.authors,
    verifiedRating: r.verifiedRating,
    openLibraryRating: r.openLibraryRating,
    openLibraryRatingCount: r.openLibraryRatingCount,
    googleRating: r.googleRating,
    sources: r.sources,
  });
}

import { researchSeries } from "../server/services/research.js";

const r = await researchSeries("Twilight Stephenie Meyer");
console.log({
  title: r.title,
  verifiedRating: r.verifiedRating,
  openLibraryRating: r.openLibraryRating,
  googleRating: r.googleRating,
  sources: r.sources,
});

const qs = [
  "Reign & Ruin",
  "Reign and Ruin J.D. Evans",
  "Mages of the Wheel J.D. Evans",
  "title:Reign author:Evans",
];

for (const q of qs) {
  const u =
    "https://openlibrary.org/search.json?q=" +
    encodeURIComponent(q) +
    "&limit=5";
  const r = await fetch(u, {
    headers: { "User-Agent": "TineRomantasyListe/1.0" },
  });
  const j = await r.json();
  console.log("\nQ:", q);
  for (const d of (j.docs || []).slice(0, 5)) {
    console.log(" -", d.title, "|", (d.author_name || []).join(", "), "|", d.key);
    if (d.key) {
      const rr = await fetch(`https://openlibrary.org${d.key}/ratings.json`, {
        headers: { "User-Agent": "TineRomantasyListe/1.0" },
      });
      if (rr.ok) {
        const ratings = await rr.json();
        console.log(
          "   rating:",
          ratings?.summary?.average,
          "n=",
          ratings?.summary?.count
        );
      }
    }
  }
}

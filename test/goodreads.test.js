import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeGoodreadsScore,
  resolveGoodreadsScore,
  isCatalogRatingDisguise,
} from "../server/services/goodreads.js";
import { migrateRow } from "../server/services/migrate.js";

describe("Goodreads-beskyttelse", () => {
  it("fjerner Open Library-strenge fra Goodreads-feltet", () => {
    assert.equal(
      sanitizeGoodreadsScore("4.21 (Open Library, n=1016)"),
      null
    );
  });

  it("bevarer ægte Goodreads-tal", () => {
    assert.equal(sanitizeGoodreadsScore(4.47), 4.47);
  });

  it("genanalyse bevarer ikke OL som Goodreads", () => {
    const resolved = resolveGoodreadsScore({
      verifiedGoodreads: null,
      existingValue: "4.21 (Open Library, n=1016)",
      preserveExisting: true,
    });
    assert.equal(resolved, null);
  });

  it("refresh sætter kun verificeret Goodreads", () => {
    const resolved = resolveGoodreadsScore({
      verifiedGoodreads: {
        value: 4.47,
        source: "Goodreads",
      },
      existingValue: "4.21 (Open Library, n=1016)",
      preserveExisting: true,
    });
    assert.equal(resolved, 4.47);
  });

  it("migrerer Harry Potter OL-streng væk fra Goodreads", () => {
    const row = migrateRow({
      "Seriens navn": "Harry Potter",
      "Goodreads-score": "4.21 (Open Library, n=1016)",
    });
    assert.equal(row["Goodreads-score"], null);
    assert.equal(row._ratingMeta.catalog.source, "Open Library");
    assert.equal(row._ratingMeta.catalog.value, 4.21);
  });

  it("genkender katalog-forklædning", () => {
    assert.equal(isCatalogRatingDisguise("4.21 (Open Library, n=1016)"), true);
  });
});

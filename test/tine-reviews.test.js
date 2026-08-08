import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  isExcludedReviewBook,
  mapPirateReadsBookForReview,
  searchPirateReadsForReview,
} from "../server/services/pirateReads.js";
import { buildLibraryRowFromReviews } from "../server/services/tineReviews.js";
import { mapIdentityToReviewTarget } from "../server/services/tineReviewTargets.js";
import { loadSeries } from "../server/services/store.js";
import {
  normalizeReviewSummary,
  reviewSummaryKey,
} from "../server/services/tineReviewSummaryUtils.js";

describe("Goodreads-hjælpere (stadig brugt af discovery)", () => {
  it("udelukker Harry Potter", () => {
    assert.equal(
      isExcludedReviewBook({
        book_title: "Harry Potter and the Philosopher's Stone (Harry Potter, #1)",
        book_author: "J.K. Rowling",
      }),
      true
    );
  });

  it("udleder serien fra Goodreads-titlen", () => {
    const book = mapPirateReadsBookForReview({
      book_title: "Iron Flame (The Empyrean, #2)",
      book_author: "Rebecca Yarros",
      book_link: "https://www.goodreads.com/book/show/90202302",
    });
    assert.equal(book.seriesName, "The Empyrean");
    assert.equal(book.firstBookTitle, "Iron Flame");
  });

  it("finder serie via Goodreads-søgning på serienavn", () => {
    const result = searchPirateReadsForReview(
      [
        {
          book_title: "Iron Flame (The Empyrean, #2)",
          book_author: "Rebecca Yarros",
          shelf: "read",
          book_link: "https://www.goodreads.com/book/show/90202302",
        },
        {
          book_title: "Fourth Wing (The Empyrean, #1)",
          book_author: "Rebecca Yarros",
          shelf: "read",
          book_link: "https://www.goodreads.com/book/show/1",
        },
      ],
      { query: "The Empyrean" }
    );
    assert.equal(result?.status, "identified");
    assert.equal(result.identity.series, "The Empyrean");
    assert.equal(result.identity.author, "Rebecca Yarros");
  });

  it("finder forfatter-hits på Goodreads som valgmuligheder", () => {
    const result = searchPirateReadsForReview(
      [
        {
          book_title: "Mist's Edge (The Broken Lands, #2)",
          book_author: "T.A. White",
          shelf: "read",
        },
        {
          book_title: "Pathfinder's Way (The Broken Lands, #1)",
          book_author: "T.A. White",
          shelf: "read",
        },
      ],
      { author: "T.A. White" }
    );
    assert.equal(result?.status, "ambiguous");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].series, "The Broken Lands");
  });
});

describe("Søg-og-godkend anmeldelsesmål", () => {
  it("mapper en serieidentitet til serieanmeldelse", () => {
    const target = mapIdentityToReviewTarget({
      title: "Mist's Edge",
      author: "T.A. White",
      series: "The Broken Lands",
      bookNumber: 2,
      identityConfidence: "high",
    });
    assert.equal(target.isSeries, true);
    assert.equal(target.seriesName, "The Broken Lands");
    assert.equal(target.firstBookTitle, "Mist's Edge");
    assert.equal(target.displayTitle, "The Broken Lands");
    assert.equal(target.source, "identity");
    assert.match(target.sourceBookId, /^identity\|the broken lands\|/);
  });

  it("mapper en bog uden serie til standalone", () => {
    const target = mapIdentityToReviewTarget({
      title: "Standalone Romance",
      author: "Some Author",
      series: null,
    });
    assert.equal(target.isSeries, false);
    assert.equal(target.seriesName, "Standalone Romance");
    assert.equal(target.displayTitle, "Standalone Romance");
  });
});

describe("Anmeldelser til seriebibliotek", () => {
  const reviews = [
    {
      sourceBookId: "identity|testserien|første bog|test forfatter",
      seriesName: "Testserien",
      firstBookTitle: "Første bog",
      author: "Test Forfatter",
      isSeries: true,
      overallScore: 90,
      comment: "Virkelig god",
      subjectiveScores: {
        "Rhysand-faktoren": { score: 5 },
        "Bully-risiko": { value: "Lav" },
      },
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
    {
      sourceBookId: "identity|testserien|anden bog|test forfatter",
      seriesName: "Testserien",
      firstBookTitle: "Anden bog",
      author: "Test Forfatter",
      isSeries: true,
      overallScore: 70,
      comment: "Lidt svagere",
      subjectiveScores: {
        "Rhysand-faktoren": { score: 3 },
      },
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
  ];

  it("samler anmeldelser og skriver 1:1-scorer ind på nye serierækker", () => {
    const row = buildLibraryRowFromReviews(reviews);
    assert.equal(row["Seriens navn"], "Testserien");
    assert.equal(row["Tines score"], 80);
    assert.equal(row["Rhysand-faktoren"], 4);
    assert.equal(row["Bully-risiko"], "Lav");
    assert.equal(row._origin.type, "tine_reviews");
    assert.equal(row._tineReviews.subjectiveAverages["Rhysand-faktoren"], 4);
  });

  it("bevarer Excel-oprindelse og overskriver ikke Excel-scorer", () => {
    const row = buildLibraryRowFromReviews(reviews, {
      Status: "Ikke læst",
      "Seriens navn": "Testserien",
      "Første bog/titel": "Første bog",
      Forfatter: "Test Forfatter",
      "Tine-score": 88,
      "Rhysand-faktoren": 5,
      _origin: { type: "excel", label: "Fra Tines Excel-ark" },
    });
    assert.equal(row._origin.type, "excel");
    assert.equal(row["Tine-score"], 88);
    assert.equal(row["Rhysand-faktoren"], 5);
    assert.equal(row["Tines score"], 80);
    assert.equal(row._tineReviews.subjectiveAverages["Rhysand-faktoren"], 4);
  });
});

describe("Nuværende biblioteksoprindelse", () => {
  it("har 15 Excel-pejlemærker og ingen Harry Potter-række", () => {
    const series = loadSeries();
    const excelRows = series.filter((row) => row._origin?.type === "excel");
    assert.equal(excelRows.length, 15);
    assert.equal(
      series.some((row) =>
        /harry\s+potter/i.test(String(row["Seriens navn"] || ""))
      ),
      false
    );
  });
});

describe("Resumé og anmeldelses-UI", () => {
  it("bruger en stabil cache-nøgle for samme bog", () => {
    const a = reviewSummaryKey({
      sourceBookId: "HTTPS://GOODREADS.COM/BOOK/123",
      firstBookTitle: "Iron Flame",
      author: "Rebecca Yarros",
    });
    const b = reviewSummaryKey({
      sourceBookId: "https://goodreads.com/book/123",
      firstBookTitle: " iron flame ",
      author: "rebecca yarros",
    });
    assert.equal(a, b);
  });

  it("begrænser og renser resuméets spoilerpunkter", () => {
    const summary = normalizeReviewSummary({
      shortSummary: "  Et kort spoilerfrit resumé.  ",
      spoilerPoints: ["Et", "To", "Tre", "Fire", "Fem", "Seks", "Syv"],
      note: "",
    });
    assert.equal(summary.shortSummary, "Et kort spoilerfrit resumé.");
    assert.deepEqual(summary.spoilerPoints, [
      "Et",
      "To",
      "Tre",
      "Fire",
      "Fem",
      "Seks",
    ]);
  });

  it("afviser et tomt AI-resumé", () => {
    assert.throws(
      () => normalizeReviewSummary({ spoilerPoints: ["Kun spoiler"] }),
      /brugbart resumé/
    );
  });

  it("har søgeflow, bekræftelse og tre underfaner", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8"
    );
    assert.match(html, /id="review-search-form"/);
    assert.match(html, /id="review-confirm"/);
    assert.match(html, /id="review-confirm-yes"/);
    assert.match(html, /Alle biblioteksscorer/);
    assert.equal((html.match(/data-review-tab="/g) || []).length, 3);
    assert.match(html, /id="review-spoilers"[^>]*hidden/);
    assert.doesNotMatch(html, /Gem og næste bog/);
    assert.doesNotMatch(html, /Én læst bog fra Goodreads/);
  });
});

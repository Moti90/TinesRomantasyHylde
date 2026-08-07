import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  isExcludedReviewBook,
  mapPirateReadsBookForReview,
} from "../server/services/pirateReads.js";
import { buildLibraryRowFromReviews } from "../server/services/tineReviews.js";
import { loadSeries } from "../server/services/store.js";
import {
  normalizeReviewSummary,
  reviewSummaryKey,
} from "../server/services/tineReviewSummaryUtils.js";

describe("Goodreads-bøger til Tines anmeldelser", () => {
  it("udelukker Harry Potter fra anmeldelseskøen", () => {
    assert.equal(
      isExcludedReviewBook({
        book_title: "Harry Potter and the Philosopher's Stone (Harry Potter, #1)",
        book_author: "J.K. Rowling",
      }),
      true
    );
    assert.equal(
      isExcludedReviewBook({
        book_title: "Fourth Wing (The Empyrean, #1)",
        book_author: "Rebecca Yarros",
      }),
      false
    );
  });

  it("bevarer bogens identitet og udleder serien fra Goodreads-titlen", () => {
    const book = mapPirateReadsBookForReview({
      book_title: "Iron Flame (The Empyrean, #2)",
      book_author: "Rebecca Yarros",
      book_link: "https://www.goodreads.com/book/show/90202302",
    });
    assert.equal(book.firstBookTitle, "Iron Flame");
    assert.equal(book.seriesName, "The Empyrean");
    assert.equal(book.author, "Rebecca Yarros");
    assert.equal(
      book.sourceBookId,
      "https://www.goodreads.com/book/show/90202302"
    );
  });
});

describe("Anmeldelser til seriebibliotek", () => {
  const reviews = [
    {
      sourceBookId: "goodreads-1",
      seriesName: "Testserien",
      firstBookTitle: "Første bog",
      author: "Test Forfatter",
      overallScore: 90,
      comment: "Virkelig god",
      subjectiveScores: { rhysand: { score: 5 } },
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
    {
      sourceBookId: "goodreads-2",
      seriesName: "Testserien",
      firstBookTitle: "Anden bog",
      author: "Test Forfatter",
      overallScore: 70,
      comment: "Lidt svagere",
      subjectiveScores: { rhysand: { score: 3 } },
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
  ];

  it("samler flere boganmeldelser i én serierække", () => {
    const row = buildLibraryRowFromReviews(reviews);
    assert.equal(row["Seriens navn"], "Testserien");
    assert.equal(row["Første bog/titel"], "Første bog");
    assert.equal(row["Tines score"], 80);
    assert.equal(row["Tine-score"], null);
    assert.equal(row._origin.type, "tine_reviews");
    assert.equal(row._tineReviews.count, 2);
    assert.equal(row._tineReviews.subjectiveAverages.rhysand, 4);
    assert.equal(row._tineReviews.reviewedBooks.length, 2);
  });

  it("bevarer Excel-oprindelse på en eksisterende serie", () => {
    const row = buildLibraryRowFromReviews(reviews, {
      Status: "Ikke læst",
      "Seriens navn": "Testserien",
      "Første bog/titel": "Første bog",
      Forfatter: "Test Forfatter",
      "Tine-score": 88,
      _origin: { type: "excel", label: "Fra Tines Excel-ark" },
    });
    assert.equal(row._origin.type, "excel");
    assert.equal(row["Tine-score"], 88);
    assert.equal(row["Tines score"], 80);
  });
});

describe("Nuværende biblioteksoprindelse", () => {
  it("har 15 Excel-pejlemærker og ingen Harry Potter-række", () => {
    const series = loadSeries();
    const excelRows = series.filter((row) => row._origin?.type === "excel");
    assert.equal(excelRows.length, 15);
    assert.equal(
      excelRows.some((row) => row["Seriens navn"] === "Dark Olympus"),
      true
    );
    assert.equal(
      excelRows.some((row) => row["Seriens navn"] === "The Empyrean"),
      false
    );
    assert.equal(
      series.some((row) =>
        /harry\s+potter/i.test(String(row["Seriens navn"] || ""))
      ),
      false
    );
  });
});

describe("Resumé til hukommelseshjælp", () => {
  it("bruger en stabil cache-nøgle for samme Goodreads-bog", () => {
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
    assert.equal(summary.note, null);
  });

  it("afviser et tomt AI-resumé", () => {
    assert.throws(
      () => normalizeReviewSummary({ spoilerPoints: ["Kun spoiler"] }),
      /brugbart resumé/
    );
  });

  it("har tre underfaner og skjuler spoilers som udgangspunkt", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8"
    );
    assert.equal((html.match(/data-review-tab="/g) || []).length, 3);
    assert.match(html, /data-review-tab-panel="overview"/);
    assert.match(html, /data-review-tab-panel="scores"/);
    assert.match(html, /data-review-tab-panel="tags"/);
    assert.match(html, /id="review-spoilers"[^>]*hidden/);
  });
});

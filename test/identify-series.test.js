import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSeriesFromText,
  inferSeriesFromQueryCluster,
} from "../server/services/identify.js";
import { mapIdentityToReviewTarget } from "../server/services/tineReviewTargets.js";
import { searchPirateReadsForReview } from "../server/services/pirateReads.js";

describe("extractSeriesFromText", () => {
  it("udleder serie og nummer fra parentes i titel", () => {
    const r = extractSeriesFromText("Mist's Edge (The Broken Lands, #2)");
    assert.equal(r.bare, "Mist's Edge");
    assert.equal(r.series, "The Broken Lands");
    assert.equal(r.bookNumber, 2);
  });

  it("udleder serie fra Book N i undertitel", () => {
    const r = extractSeriesFromText("Mist's Edge", "The Broken Lands, Book 2");
    assert.equal(r.bare, "Mist's Edge");
    assert.equal(r.series, "The Broken Lands");
    assert.equal(r.bookNumber, 2);
  });

  it("udleder serie fra Book N of Serie", () => {
    const r = extractSeriesFromText("Iron Flame", "Book 2 of The Empyrean");
    assert.equal(r.series, "The Empyrean");
    assert.equal(r.bookNumber, 2);
  });
});

describe("Serie vs standalone mapping", () => {
  it("titel med serie i identity bliver serieanmeldelse", () => {
    const target = mapIdentityToReviewTarget({
      title: "Mist's Edge",
      author: "T.A. White",
      series: "The Broken Lands",
    });
    assert.equal(target.isSeries, true);
    assert.equal(target.displayTitle, "The Broken Lands");
  });
});

describe("Serie-inferens fra titel-klynge", () => {
  it("udleder Harry Potter som serie når flere bind matcher søgningen", () => {
    const series = inferSeriesFromQueryCluster(
      [
        {
          title: "Harry Potter",
          author: "J. K. Rowling",
          series: null,
        },
        {
          title: "Harry Potter and the Philosopher's Stone",
          author: "J. K. Rowling",
          series: null,
        },
        {
          title: "Harry Potter and the Chamber of Secrets",
          author: "J. K. Rowling",
          series: null,
        },
      ],
      "harry potter"
    );
    assert.equal(series, "Harry Potter");
    const target = mapIdentityToReviewTarget({
      title: "Harry Potter and the Philosopher's Stone",
      author: "J. K. Rowling",
      series,
    });
    assert.equal(target.isSeries, true);
    assert.equal(target.displayTitle, "Harry Potter");
  });

  it("laver ikke serie af et enkelt standalone-hit", () => {
    const series = inferSeriesFromQueryCluster(
      [{ title: "Fourth Wing", author: "Rebecca Yarros", series: null }],
      "Fourth Wing"
    );
    assert.equal(series, null);
  });
});

describe("Goodreads-søgning: eksplicit HP-søgning", () => {
  it("finder Harry Potter-serien når brugeren søger eksplicit", () => {
    const result = searchPirateReadsForReview(
      [
        {
          book_title: "Harry Potter and the Philosopher's Stone (Harry Potter, #1)",
          book_author: "J.K. Rowling",
          shelf: "read",
        },
        {
          book_title: "Harry Potter and the Chamber of Secrets (Harry Potter, #2)",
          book_author: "J.K. Rowling",
          shelf: "read",
        },
        {
          book_title: "Iron Flame (The Empyrean, #2)",
          book_author: "Rebecca Yarros",
          shelf: "read",
        },
      ],
      { query: "Harry Potter" }
    );
    assert.equal(result?.status, "identified");
    assert.equal(result.identity.series, "Harry Potter");
    assert.equal(result.identity.author, "J.K. Rowling");
  });
});

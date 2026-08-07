import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSeriesFromText } from "../server/services/identify.js";
import { mapIdentityToReviewTarget } from "../server/services/tineReviewTargets.js";

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

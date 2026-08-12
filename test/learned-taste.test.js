import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyLearnedTasteAdjustment,
  formatLearnedTasteReason,
  rebuildLearnedTaste,
} from "../server/services/learnedTaste.js";

describe("learned taste MVP", () => {
  it("aggererer anmeldelser og justerer indholdsmatch", () => {
    const reviews = [];
    for (let i = 0; i < 12; i++) {
      reviews.push({
        overallScore: i < 8 ? 85 : 30,
        rereadChoice: i < 8 ? "yes" : "no",
        ignoredFields: [],
        positives: i < 8 ? ["Beskyttende helt"] : [],
        negatives: i >= 8 ? ["Bully / nedladende MMC"] : [],
        subjectiveScores: {
          "Rhysand-faktoren": { score: i < 8 ? 5 : 1 },
          "Beskyttende helt(e) (0-5)": { score: i < 8 ? 5 : 1 },
          "Spice/erotik (0-5)": { score: 3 },
        },
      });
    }
    // Mark some ignored - should not affect Rhysand mean if only ignored ones have different values
    reviews.push({
      overallScore: 90,
      ignoredFields: ["Rhysand-faktoren"],
      subjectiveScores: {
        "Rhysand-faktoren": { score: 0 },
        "Beskyttende helt(e) (0-5)": { score: 5 },
      },
    });

    const learned = rebuildLearnedTaste(reviews);
    assert.ok(learned.scoredReviewCount >= 12);
    assert.ok(learned.fieldPrefs["Rhysand-faktoren"]);
    assert.ok(learned.fieldPrefs["Rhysand-faktoren"].mean > 3);

    const goodFit = applyLearnedTasteAdjustment(
      {
        "Rhysand-faktoren": 5,
        "Beskyttende helt(e) (0-5)": 5,
        "Bully-risiko": "Lav",
      },
      70,
    );
    assert.ok(goodFit.delta >= 0);

    const badFit = applyLearnedTasteAdjustment(
      {
        "Rhysand-faktoren": 1,
        "Beskyttende helt(e) (0-5)": 1,
        "Bully-risiko": "Høj",
        "Spice/erotik (0-5)": 5,
        "Episk plot (0-5)": 1,
      },
      70,
    );
    assert.ok(badFit.delta <= goodFit.delta);

    const reason = formatLearnedTasteReason(goodFit, "Base.");
    if (goodFit.delta) {
      assert.match(reason, /Anmeldelseslæring/);
    }
  });
});

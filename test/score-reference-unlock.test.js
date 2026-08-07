import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyReferenceScores,
  getReferenceForSeries,
  isReferenceUnlocked,
} from "../server/services/scoreReference.js";

describe("Excel-unlock for The Redemption Saga", () => {
  it("behandler Redemption som ulåst", () => {
    assert.equal(isReferenceUnlocked("The Redemption Saga"), true);
    assert.equal(getReferenceForSeries("The Redemption Saga"), null);
  });

  it("låser ikke Redemption ved applyReferenceScores", () => {
    const row = applyReferenceScores({
      "Seriens navn": "The Redemption Saga",
      "Worldbuilding (0-5)": 2,
    });
    assert.equal(row._scoreReference?.locked, false);
    assert.equal(row["Worldbuilding (0-5)"], 2);
  });

  it("låser stadig andre Excel-serier", () => {
    assert.equal(isReferenceUnlocked("Mages of the Wheel"), false);
  });
});

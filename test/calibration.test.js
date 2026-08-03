import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCalibrationAnchors } from "../server/services/calibration.js";

describe("kalibrerings-ankre", () => {
  it("returnerer ankre fra Tine-score når Tines score mangler", () => {
    const anchors = getCalibrationAnchors(6);
    assert.ok(anchors.length >= 2, "forventer mindst 2 ankre fra Excel-reference");
    for (const a of anchors) {
      assert.ok(a.serie);
      assert.ok(typeof a.score === "number");
      assert.ok(
        ["tines_egen", "excel_reference", "db_fallback"].includes(a.scoreSource)
      );
    }
    const scores = anchors.map((a) => a.score);
    assert.ok(Math.max(...scores) >= Math.min(...scores));
  });

  it("blander høje og lave scores", () => {
    const anchors = getCalibrationAnchors(4);
    if (anchors.length < 2) return;
    const scores = anchors.map((a) => a.score);
    assert.ok(
      Math.max(...scores) - Math.min(...scores) >= 5,
      "ankre bør have spredning mellem høj og lav"
    );
  });

  it("Excel-reference giver Mages 99 når filen er importeret", async () => {
    const { loadScoreReference } = await import(
      "../server/services/scoreReference.js"
    );
    const ref = loadScoreReference();
    if (!ref) {
      // Importeres via scripts/import-score-reference.js
      return;
    }
    const key = Object.keys(ref.bySerie).find((k) => k.includes("mages"));
    assert.ok(key, "Mages of the Wheel skal findes i score-reference");
    assert.equal(ref.bySerie[key]["Tine-score"], 99);
  });
});

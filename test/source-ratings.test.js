import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractExplicitSourceRatings } from "../server/services/handbookAnalysis.js";

describe("eksplicitte kilde-ratings", () => {
  it("læser World-Building 4/5 og Character Development 4.5", () => {
    const extracted = extractExplicitSourceRatings({
      sources: [
        {
          id: "source-1",
          batch: "plotkarakter",
          title: "Iron Flame review – bromantasy",
          summary:
            "Rating dashboard: World-Building 4/5. Character Development 4.5/5. Plot & Pacing 5/5. Spice 3 chili.",
        },
      ],
    });
    assert.equal(extracted["Worldbuilding (0-5)"]?.score, 4);
    assert.equal(extracted["Karakterudvikling (0-5)"]?.score, 5); // 4.5 → 5
    assert.equal(extracted["Episk plot (0-5)"]?.score, 5);
    assert.equal(extracted["Spice/erotik (0-5)"]?.score, 3);
    assert.match(
      extracted["Worldbuilding (0-5)"].reason,
      /Eksplicit rating/i
    );
  });

  it("laver gennemsnit når kilder er uenige", () => {
    const extracted = extractExplicitSourceRatings({
      sources: [
        {
          id: "a",
          batch: "plotkarakter",
          title: "A",
          summary: "World-Building 5/5",
        },
        {
          id: "b",
          batch: "plotkarakter",
          title: "B",
          summary: "World-Building 1/5",
        },
        {
          id: "c",
          batch: "plotkarakter",
          title: "C",
          summary: "World-Building 1/5",
        },
        {
          id: "d",
          batch: "plotkarakter",
          title: "D",
          summary: "World-Building 1/5",
        },
        {
          id: "e",
          batch: "plotkarakter",
          title: "E",
          summary: "World-Building 1/5",
        },
      ],
    });
    // (5+1+1+1+1)/5 = 1.8 → 2
    assert.equal(extracted["Worldbuilding (0-5)"]?.score, 2);
    assert.match(extracted["Worldbuilding (0-5)"].reason, /Gennemsnit/i);
    assert.equal(extracted["Worldbuilding (0-5)"]?.confidence, "low");
  });

  it("gætter ikke uden tal", () => {
    const extracted = extractExplicitSourceRatings({
      sources: [
        {
          id: "s1",
          batch: "plotkarakter",
          title: "Nice fantasy",
          summary: "Great worldbuilding and characters overall.",
        },
      ],
    });
    assert.equal(extracted["Worldbuilding (0-5)"], undefined);
  });
});

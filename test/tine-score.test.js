import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTineScoreFromVibes } from "../server/services/handbookAnalysis.js";

describe("Tine-score beregning", () => {
  it("giver forskellige scorer for forskellige vibe-profiler", () => {
    const kidsFantasy = estimateTineScoreFromVibes({
      "Episk plot (0-5)": 5,
      "Worldbuilding (0-5)": 5,
      "Kvindelig udvikling (0-5)": 3,
      "Karakterudvikling (0-5)": 4,
      "Beskyttende helt(e) (0-5)": 3,
      "Bodyguard-vibe (0-5)": 1,
      "Touch her and die-vibe (0-5)": 1,
      "Rhysand-faktoren": 2,
      "Book hangover (0-5)": 4,
      "Spice/erotik kvalitet (0-5)": 0,
      "Romance i fokus (0-100%)": 20,
    });
    const romantasy = estimateTineScoreFromVibes({
      "Episk plot (0-5)": 5,
      "Worldbuilding (0-5)": 4,
      "Kvindelig udvikling (0-5)": 4,
      "Karakterudvikling (0-5)": 4,
      "Beskyttende helt(e) (0-5)": 5,
      "Bodyguard-vibe (0-5)": 5,
      "Touch her and die-vibe (0-5)": 5,
      "Rhysand-faktoren": 5,
      "Book hangover (0-5)": 4,
      "Spice/erotik kvalitet (0-5)": 4,
      "Romance i fokus (0-100%)": 90,
    });
    assert.ok(kidsFantasy != null && romantasy != null);
    assert.ok(romantasy > kidsFantasy);
    assert.notEqual(kidsFantasy, 75);
    assert.notEqual(romantasy, 75);
  });
});

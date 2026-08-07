import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECTIVE_KEYS,
  buildUncertaintyProfile,
  calculateReadPriority,
  estimateTineScoreFromVibes,
} from "../server/services/decisionScores.js";
import { applyDecisionScoresToRow } from "../server/services/decisionScoreSync.js";
import { sortSeries } from "../server/services/columns.js";

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

function verifiedFacts() {
  return {
    publishedBookCount: { value: 4, status: "verified" },
    audiobook: { value: "Ja", status: "verified" },
    mofiboAvailability: { value: "Ja", status: "verified" },
    seriesStatus: { value: "finished", status: "verified" },
    danishEdition: { value: "Ja", status: "verified" },
    sameMainCouple: { value: "Ja", status: "verified" },
  };
}

describe("samlet analysegrundlag", () => {
  it("markerer bredt kildegrundlag som stærkt", () => {
    const assessments = Object.fromEntries(
      SUBJECTIVE_KEYS.map((key) => [
        key,
        {
          score: 4,
          confidence: "medium",
          basis: "source_consensus",
          sourceCount: 2,
          evidenceSourceIds: ["source-1"],
        },
      ])
    );
    const profile = buildUncertaintyProfile(
      {
        facts: verifiedFacts(),
        researchedAt: new Date().toISOString(),
      },
      assessments
    );
    assert.equal(profile.level, "strong");
    assert.equal(profile.sourceCoverage, 100);
    assert.equal(profile.inferredFields.length, 0);
    assert.equal(profile.notVerifiedFacts.length, 0);
  });

  it("markerer modelvurderinger og manglende fakta som tyndt grundlag", () => {
    const assessments = Object.fromEntries(
      SUBJECTIVE_KEYS.map((key) => [
        key,
        {
          score: 3,
          confidence: "low",
          basis: "ai_inference",
          sourceCount: 0,
          evidenceSourceIds: [],
        },
      ])
    );
    const profile = buildUncertaintyProfile(
      { facts: {}, researchedAt: new Date().toISOString() },
      assessments
    );
    assert.equal(profile.level, "thin");
    assert.equal(profile.sourceCoverage, 0);
    assert.equal(profile.inferredFields.length, SUBJECTIVE_KEYS.length);
    assert.equal(profile.notVerifiedFacts.length, 6);
  });
});

describe("læseprioritet nu", () => {
  it("bevarer indholdsmatch når intet praktisk trækker ned", () => {
    const result = calculateReadPriority(
      {
        "Er serien færdigskrevet": "Ja",
        "Er serien på Mofibo? (ja, nej, ikke hele serien)": "Ja",
        "Lydbog (ja/nej, ikke hele serien)": "Ja",
        "Bully-risiko": "Lav",
        "Tilfredsstillende slutning?": "Ja",
      },
      92,
      { level: "strong" }
    );
    assert.equal(result.score, 92);
    assert.equal(result.totalAdjustment, 0);
  });

  it("viser hvert praktisk fradrag separat", () => {
    const result = calculateReadPriority(
      {
        "Er serien færdigskrevet": "Nej",
        "Er serien på Mofibo? (ja, nej, ikke hele serien)": "Nej",
        "Lydbog (ja/nej, ikke hele serien)": "Nej",
        "Bully-risiko": "Høj",
        "Tilfredsstillende slutning?": "Nej",
      },
      90,
      { level: "thin" }
    );
    assert.equal(result.score, 41);
    assert.equal(result.totalAdjustment, -49);
    assert.deepEqual(
      result.adjustments.map((adjustment) => adjustment.key),
      [
        "series_unfinished",
        "mofibo_no",
        "audiobook_no",
        "bully_high",
        "ending_unsatisfying",
        "thin_foundation",
      ]
    );
  });

  it("behandler permanente dødsfald som et tydeligt no go", () => {
    const result = calculateReadPriority(
      {
        "Er serien færdigskrevet": "Ja",
        "Er serien på Mofibo? (ja, nej, ikke hele serien)": "Ja",
        "Lydbog (ja/nej, ikke hele serien)": "Ja",
        "Bully-risiko": "Lav",
        "Tilfredsstillende slutning?": "Ja",
        "Permanente dødsfald blandt hovedpersonerne?": "Ja",
      },
      90,
      { level: "strong" }
    );
    assert.equal(result.score, 70);
    assert.equal(result.adjustments[0].key, "permanent_main_death");
  });

  it("synkroniserer et låst Excel-pejlemærke før prioriteten beregnes", () => {
    const meta = {
      uncertainty: { level: "strong" },
      assessments: {},
    };
    const { row } = applyDecisionScoresToRow(
      {
        "Tine-score": 99,
        Indholdsmatch: 70,
        "Er serien færdigskrevet": "Ja",
        "Er serien på Mofibo? (ja, nej, ikke hele serien)": "Ja",
        "Lydbog (ja/nej, ikke hele serien)": "Ja",
        "Bully-risiko": "Lav",
        "Tilfredsstillende slutning?": "Ja",
        _scoreReference: { locked: true },
      },
      meta
    );
    assert.equal(row.Indholdsmatch, 99);
    assert.equal(row["Læseprioritet nu"], 99);
    assert.match(
      meta.assessments.Indholdsmatch.reason,
      /Tines Excel-ark/
    );
  });

  it("sorterer biblioteket efter læseprioritet med indholdsmatch som reserve", () => {
    const sorted = sortSeries([
      {
        Status: "Ikke læst",
        "Seriens navn": "Høj match, lav prioritet",
        Indholdsmatch: 95,
        "Læseprioritet nu": 60,
      },
      {
        Status: "Ikke læst",
        "Seriens navn": "Lavere match, høj prioritet",
        Indholdsmatch: 85,
        "Læseprioritet nu": 82,
      },
      {
        Status: "Ikke læst",
        "Seriens navn": "Gammel række",
        "Tine-score": 80,
      },
    ]);
    assert.deepEqual(
      sorted.map((row) => row["Seriens navn"]),
      [
        "Lavere match, høj prioritet",
        "Gammel række",
        "Høj match, lav prioritet",
      ]
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAssessment,
  findPhenomenonSourceIds,
  attachPhenomenonEvidence,
} from "../server/services/evidenceMapping.js";
import { ANALYSIS_PROMPT_VERSION } from "../server/services/versions.js";

describe("Løsnet evidens-mapping", () => {
  it("bruger analysis-v14", () => {
    assert.equal(ANALYSIS_PROMPT_VERSION, "analysis-v14");
  });

  it("genkender touch-her-and-die fra synonym-beskrivelse", () => {
    const research = {
      sources: [
        {
          id: "source-1",
          batch: "helteprofil",
          title: "Review",
          summary: "He would kill for her and goes feral when she is threatened.",
        },
      ],
    };
    const ids = findPhenomenonSourceIds("Touch her and die-vibe (0-5)", research);
    assert.deepEqual(ids, ["source-1"]);
  });

  it("opgraderer ai_inference til source_consensus ved fænomen-match", () => {
    const research = {
      identity: { confidence: "high" },
      sources: [
        {
          id: "source-a",
          batch: "helteprofil",
          title: "Protective MMC",
          summary: "He keeps her safe and acts like a bodyguard.",
        },
        {
          id: "source-b",
          batch: "helteprofil",
          title: "Another take",
          summary: "Very protective hero watching over her.",
        },
      ],
      reviewConsensus: {},
    };
    const assessments = {
      "Bodyguard-vibe (0-5)": {
        score: 4,
        confidence: "low",
        basis: "ai_inference",
        reason: "Vurderet ud fra modelviden uden direkte kildebelæg.",
        sourceBatch: "helteprofil",
        sourceCount: 0,
        evidenceSourceIds: [],
      },
      "Beskyttende helt(e) (0-5)": {
        score: 4,
        confidence: "low",
        basis: "ai_inference",
        reason: "Ingen direkte kilder.",
        sourceBatch: "helteprofil",
        sourceCount: 2,
        evidenceSourceIds: [],
      },
    };
    attachPhenomenonEvidence(assessments, research);

    assert.equal(assessments["Bodyguard-vibe (0-5)"].basis, "source_consensus");
    assert.ok(
      assessments["Bodyguard-vibe (0-5)"].evidenceSourceIds.includes("source-a")
    );
    assert.equal(assessments["Bodyguard-vibe (0-5)"].confidence, "medium");

    assert.equal(
      assessments["Beskyttende helt(e) (0-5)"].basis,
      "source_consensus"
    );
    assert.ok(
      assessments["Beskyttende helt(e) (0-5)"].evidenceSourceIds.length >= 1
    );
  });

  it("tillader medium confidence ved én fænomen-kilde med source_consensus", () => {
    const a = normalizeAssessment(
      {
        score: 5,
        confidence: "medium",
        basis: "source_consensus",
        reason: "Would kill for her",
        sourceBatch: "helteprofil",
        sourceCount: 1,
        evidenceSourceIds: ["source-1"],
      },
      "Touch her and die-vibe (0-5)",
      {
        identity: { confidence: "high" },
        sources: [
          {
            id: "source-1",
            batch: "helteprofil",
            summary: "would kill for her",
          },
        ],
      }
    );
    assert.equal(a.confidence, "medium");
    assert.equal(a.basis, "source_consensus");
    assert.equal(a.score, 5);
  });

  it("tvinger stadig high ned til medium ved kun én kilde", () => {
    const a = normalizeAssessment({
      score: 5,
      confidence: "high",
      basis: "source_consensus",
      reason: "Én blog",
      evidenceSourceIds: ["source-1"],
      conflictingSourceIds: [],
    });
    assert.equal(a.confidence, "medium");
  });

  it("udfilder tomt felt når flere kilder beskriver fænomenet", () => {
    const research = {
      identity: { confidence: "high" },
      sources: [
        {
          id: "s1",
          batch: "helteprofil",
          summary: "morally grey MMC who respects her agency",
        },
        {
          id: "s2",
          batch: "helteprofil",
          summary: "supports her power and equal partner dynamic",
        },
      ],
      reviewConsensus: {},
    };
    const assessments = {
      "Rhysand-faktoren": {
        score: null,
        confidence: "low",
        basis: "insufficient",
        reason: "Ikke verificeret",
        evidenceSourceIds: [],
      },
    };
    attachPhenomenonEvidence(assessments, research);
    assert.equal(assessments["Rhysand-faktoren"].score, 4);
    assert.equal(assessments["Rhysand-faktoren"].basis, "source_consensus");
    assert.equal(assessments["Rhysand-faktoren"].confidence, "medium");
    assert.equal(assessments["Rhysand-faktoren"].evidenceSourceIds.length, 2);
  });
});

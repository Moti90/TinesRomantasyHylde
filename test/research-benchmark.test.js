import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  calculateEvidencePrecision,
  calculateReferenceRecall,
  compareBaselineAdaptive,
  detectFailureFlags,
  evaluateSeriesBenchmark,
  findGroundTruth,
  heuristicFieldEvidenceRelevance,
  independenceReport,
  lookupEvidenceLabel,
  renderReviewMarkdown,
  sourceTypeDistribution,
  validateCharacters,
  costReport,
} from "../server/services/researchBenchmark.js";
import { canonicalizeUrl } from "../server/services/webResearch.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

function loadOfflineEval() {
  const fixture = loadJson("benchmark/fixtures/shadowbound-offline.json");
  const truth = loadJson("benchmark/research-ground-truth.json");
  const gt = findGroundTruth(truth, fixture.id, fixture.identity);
  return evaluateSeriesBenchmark({
    id: fixture.id,
    category: fixture.category,
    identity: fixture.identity,
    baselineResearch: fixture.baseline.research,
    baselineAnalysis: fixture.baseline.analysis,
    adaptiveResearch: fixture.adaptive.research,
    adaptiveAnalysis: fixture.adaptive.analysis,
    followUpJobs: fixture.adaptive.followUpJobs,
    groundTruth: gt,
    mode: "offline",
  });
}

describe("research benchmark harness", () => {
  it("beregner precision kun fra labels (2/3)", () => {
    const research = {
      sources: [
        { id: "source-3", url: "https://reddit.com/r/RomanceBooks/comments/offaaa111/one" },
        { id: "source-4", url: "https://www.goodreads.com/review/show/off2" },
        { id: "source-5", url: "https://off.bookblog.example.com/review" },
      ],
    };
    const labels = {
      "https://reddit.com/r/RomanceBooks/comments/offaaa111/one": "relevant",
      "https://www.goodreads.com/review/show/off2": "relevant",
      "https://off.bookblog.example.com/review": "irrelevant",
    };
    const result = calculateEvidencePrecision({
      field: "Bodyguard-vibe (0-5)",
      assessment: { evidenceSourceIds: ["source-3", "source-4", "source-5"] },
      research,
      labels,
    });
    assert.equal(result.precision, 0.6667);
    assert.equal(result.labeledCount, 3);
    assert.equal(result.relevantCount, 2);
  });

  it("canonical URL matching til labels og recall", () => {
    const source = {
      id: "source-1",
      url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/foo?utm_source=share",
    };
    const canon = canonicalizeUrl(source.url);
    const labels = { [canon]: "relevant" };
    assert.equal(lookupEvidenceLabel(source, labels), "relevant");

    const recall = calculateReferenceRecall({
      field: "Bodyguard-vibe (0-5)",
      research: { sources: [source] },
      referenceEvidence: [
        { url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/bar" },
        { url: "https://independent.example.org/missed" },
      ],
    });
    assert.equal(recall.foundCount, 1);
    assert.equal(recall.recall, 0.5);
  });

  it("human precision forbliver uafhængig af production heuristic", () => {
    const research = {
      sources: [
        {
          id: "source-1",
          url: "https://blog.example.com/a",
          type: "blog",
          summary: "He is powerful and ruthless.",
        },
      ],
    };
    const assessment = { evidenceSourceIds: ["source-1"] };
    const human = calculateEvidencePrecision({
      field: "Bodyguard-vibe (0-5)",
      assessment,
      research,
      labels: { "https://blog.example.com/a": "relevant" },
    });
    const heuristic = heuristicFieldEvidenceRelevance({
      field: "Bodyguard-vibe (0-5)",
      assessment,
      research,
    });
    assert.equal(human.precision, 1);
    assert.equal(heuristic.fieldSpecificCount, 0);
    assert.ok(heuristic.byLevel.contextual >= 1 || heuristic.byLevel.none >= 1);
  });

  it("unlabelled evidence giver precision null, ikke false", () => {
    const result = calculateEvidencePrecision({
      field: "Bodyguard-vibe (0-5)",
      assessment: { evidenceSourceIds: ["source-1"] },
      research: { sources: [{ id: "source-1", url: "https://x.example.com/a" }] },
      labels: {},
    });
    assert.equal(result.precision, null);
    assert.equal(result.unlabeledCount, 1);
  });

  it("tom referenceEvidence giver recall null", () => {
    const recall = calculateReferenceRecall({
      field: "Rhysand-faktoren",
      research: { sources: [] },
      referenceEvidence: [],
    });
    assert.equal(recall.recall, null);
  });

  it("partial ground truth: kun labelled kilder indgår i precision", () => {
    const result = calculateEvidencePrecision({
      field: "Bodyguard-vibe (0-5)",
      assessment: { evidenceSourceIds: ["a", "b"] },
      research: {
        sources: [
          { id: "a", url: "https://a.example.com/1" },
          { id: "b", url: "https://b.example.com/2" },
        ],
      },
      labels: { "https://a.example.com/1": "relevant" },
    });
    assert.equal(result.precision, 1);
    assert.equal(result.labeledCount, 1);
    assert.equal(result.unlabeledCount, 1);
  });

  it("source mix og independence", () => {
    const sources = [
      { id: "1", url: "https://reddit.com/r/x/comments/aaa111/one", type: "forum" },
      { id: "2", url: "https://reddit.com/r/y/comments/bbb222/two", type: "forum" },
      { id: "3", url: "https://www.goodreads.com/review/show/1", type: "goodreads" },
    ];
    const dist = sourceTypeDistribution(sources);
    assert.ok(dist.shares.reader_community > 0.5);
    const ind = independenceReport(sources);
    assert.equal(ind.uniqueUrls, 3);
    assert.equal(ind.uniqueDomains, 2);
  });

  it("character validation matcher expected vs inferred", () => {
    const ok = validateCharacters({
      identity: { mmc: "Kael", fmc: "Lys" },
      research: { sources: [] },
      expectedCharacters: { mmc: "Kael", fmc: "Lys" },
    });
    assert.equal(ok.status, "match");
    const bad = validateCharacters({
      identity: {},
      research: { sources: [] },
      expectedCharacters: { mmc: "Rhysand", fmc: "Feyre" },
    });
    assert.equal(bad.status, "mismatch");
  });

  it("cost metrics og baseline vs adaptive comparison", () => {
    const comparison = compareBaselineAdaptive(
      { sourceCount: 2, relevantSourceCount: 0, weightedCoverage: 10, criticalCoverage: 8, costUsd: 0.09 },
      { sourceCount: 5, relevantSourceCount: 3, weightedCoverage: 54, criticalCoverage: 40, costUsd: 0.24 }
    );
    assert.equal(comparison.sourceCountDelta, 3);
    assert.equal(comparison.weightedCoverageDelta, 44);
    assert.equal(comparison.improvedRelevantSources, true);
    const cost = costReport({
      baseline: { costUsd: 0.09 },
      adaptiveMeta: {
        initialResearchCostUsd: 0.09,
        additionalCostUsd: 0.15,
        totalResearchCostUsd: 0.24,
        initialCoverage: 10,
        finalCoverage: 54,
        rounds: [{ newRelevantSources: 2 }],
      },
    });
    assert.equal(cost.initialResearchCostUsd, 0.09);
    assert.equal(cost.adaptiveAdditionalCostUsd, 0.15);
    assert.equal(cost.costPerUsefulAddedSource, 0.075);
    assert.ok(cost.adaptiveSplit.note.includes("estimate"));
  });

  it("failure flags: overconfidence, premature stop, publisher-heavy", () => {
    const flags = detectFailureFlags({
      baseline: { weightedCoverage: 10 },
      adaptive: {
        metrics: { criticalFieldsBelowMinimum: ["Bodyguard-vibe (0-5)"] },
        research: { sources: [] },
        analysis: { meta: { assessments: {} } },
      },
      fields: [
        {
          field: "Bodyguard-vibe (0-5)",
          critical: true,
          finalCoverage: 92,
          evidencePrecision: 0.4,
          evidenceSourceIds: ["s1"],
        },
      ],
      characters: { status: "mismatch", expected: { mmc: "A" }, inferred: { mmc: "" } },
      adaptiveMeta: {
        stopReason: "target_reached",
        additionalCostUsd: 0.01,
        rounds: [{ webSearchCalls: 2, newRelevantSources: 0 }],
      },
      remainingGaps: [{ field: "Bodyguard-vibe (0-5)", conflictLevel: "meaningful" }],
    });
    const codes = flags.map((f) => f.code);
    assert.ok(codes.includes("OVERCONFIDENT_COVERAGE"));
    assert.ok(codes.includes("PREMATURE_STOP"));
    assert.ok(codes.includes("CONFLICT_UNRESOLVED"));
    assert.ok(codes.includes("CHARACTER_IDENTIFICATION_FAILURE"));
    assert.ok(codes.includes("QUERY_LOW_YIELD"));
  });

  it("offline fixture: baseline vs adaptive + review export med URLs", () => {
    const result = loadOfflineEval();
    assert.ok(result.adaptive.sourceCount > result.baseline.sourceCount);
    assert.ok(result.comparison.weightedCoverageDelta !== undefined);
    const bodyguard = result.fields.find((f) => f.field === "Bodyguard-vibe (0-5)");
    assert.equal(bodyguard.evidencePrecision, 0.6667);
    assert.equal(bodyguard.referenceRecall, 0.6667);
    assert.equal(result.characters.status, "match");
    const md = result.reviewMarkdown || renderReviewMarkdown(result);
    assert.match(md, /SERIES: Shadowbound/);
    assert.match(md, /INITIAL EVIDENCE/);
    assert.match(md, /ADDED BY ROUND 1/);
    assert.match(md, /FINAL EVIDENCE/);
    assert.match(md, /reddit\.com/);
    assert.match(md, /Are these sources actually sufficient/);
    assert.match(md, /hero_protective_dynamic/);
    assert.match(md, /## RETRIEVAL/);
    assert.ok(result.retrieval);
    assert.ok("zeroRetrievalRate" in result.retrieval);
    assert.match(md, /STOP: target_reached/);
    assert.match(md, /ROUND 1/);
    assert.equal(result.identityResolutionTriggered, false);
    assert.equal(result.identityChanged, false);
    assert.ok("identityBefore" in result);
    assert.ok("identityAfter" in result);
    assert.ok("expectedCharacters" in result);
    assert.ok("identityCostUsd" in result);
  });

  it("CHARACTER_IDENTIFICATION_FAILURE compares identityAfter, not pre-gate source inference", () => {
    const book1Tamlinish = {
      sources: [
        {
          id: "s1",
          summary:
            "Book 1: romance between Lysa and Aric. Aric is the male love interest in the first book.",
          url: "https://publisher.example.com/book1",
          type: "blog",
        },
      ],
    };
    const unresolvedAfter = {
      mmc: "",
      fmc: "Lysa",
      confidence: "low",
      resolved: false,
      reason: "missing_lead",
    };
    const unresolved = validateCharacters({
      identity: { series: "Skyborne Cycle", title: "First Flight", isSeries: true },
      research: book1Tamlinish,
      expectedCharacters: { mmc: "Bram", fmc: "Lysa" },
      identityBefore: { mmc: "Aric", fmc: "Lysa", resolved: false },
      identityAfter: unresolvedAfter,
    });
    assert.equal(unresolved.status, "unresolved");
    assert.notEqual(unresolved.inferred.mmc, "Bram");

    const flagsUnresolved = detectFailureFlags({
      baseline: { weightedCoverage: 10 },
      adaptive: {
        metrics: { criticalFieldsBelowMinimum: [], weightedCoverage: 12 },
        research: book1Tamlinish,
        analysis: { meta: { assessments: {} } },
      },
      fields: [],
      characters: unresolved,
      adaptiveMeta: { stopReason: "no_new_evidence", additionalCostUsd: 0.02, rounds: [] },
      remainingGaps: [],
    });
    const unresolvedCodes = flagsUnresolved.map((f) => f.code);
    assert.ok(unresolvedCodes.includes("CHARACTER_IDENTIFICATION_UNRESOLVED"));
    assert.equal(unresolvedCodes.includes("CHARACTER_IDENTIFICATION_FAILURE"), false);

    const afterOk = validateCharacters({
      identity: { series: "Skyborne Cycle", isSeries: true },
      research: book1Tamlinish,
      expectedCharacters: { mmc: "Bram", fmc: "Lysa" },
      identityAfter: {
        mmc: "Bram",
        fmc: "Lysa",
        confidence: "high",
        resolved: true,
      },
    });
    assert.equal(afterOk.status, "match");
  });

  it("npm test / harness laver ikke live API-kald", () => {
    const src = readFileSync(
      join(ROOT, "server/services/researchBenchmark.js"),
      "utf8"
    );
    assert.equal(src.includes("adaptiveResearchLoop"), false);
    assert.equal(src.includes("runWebResearch"), false);
    assert.equal(src.includes("runHandbookAnalysis"), false);
    assert.equal(src.includes("responses.create"), false);
  });
});

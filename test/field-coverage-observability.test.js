import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFieldCoverage,
  calculateResearchCoverage,
  mergeAdaptiveSources,
  sourceIdentityKey,
} from "../server/services/adaptiveResearch.js";
import {
  buildRoundFieldCoverageObservability,
  compactFieldSnapshot,
  compareEligibleVsCounted,
  diagnoseEligibleNotCounted,
  NOT_COUNTED_REASONS,
} from "../server/services/fieldCoverageObservability.js";
import {
  buildJobSourceFlow,
  classifyDraftEvidence,
} from "../server/services/sourceFlow.js";
import {
  criticalFieldStopQualitySatisfied,
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import { evaluateEvidenceQualityForField } from "../server/services/evidenceQuality.js";
import { executeFocusedJobWithFallback } from "../server/services/adaptiveResearchLoop.js";
import { subjectIdentityFrom } from "../server/services/sourceSubject.js";
import { BENCHMARK_VERSION } from "../server/services/researchBenchmark.js";
import { ADAPTIVE_VERSION } from "../server/services/versions.js";
import { buildSearchPlan } from "../server/services/webResearch.js";
import { SUBJECTIVE_KEYS, getTineFieldWeight } from "../server/services/decisionScores.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const HANGOVER = "Book hangover (0-5)";
const B = "Bram";
const HEROINE = "Elowen";
const ALT = "Aldric";

const leads = {
  mmc: B,
  fmc: HEROINE,
  confidence: "high",
  resolution: { resolved: true, reason: "series_pairing_confirmed" },
  alternatives: [{ name: ALT, role: "early_love_interest" }],
};

function ctx() {
  return {
    leadCharacters: leads,
    identity: { title: "The Ember Cycle" },
    ...subjectIdentityFrom({}, {}, { leadCharacters: leads }),
  };
}

function assessment(over = {}) {
  return {
    score: 4,
    confidence: "medium",
    basis: "source_consensus",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function coverageOf(field, sources, extra = {}) {
  return calculateFieldCoverage({
    field,
    assessment: assessment({
      evidenceSourceIds: sources.map((s) => s.id).filter(Boolean),
      ...extra.assessment,
    }),
    research: {
      sources,
      seriesIdentity: leads,
    },
    identity: { title: "The Ember Cycle" },
    leadCharacters: leads,
  });
}

function fandom(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Guide ${id}`,
    url: extra.url || `https://${id}.fandom.com/wiki/Hero`,
    type: extra.type || "other",
    summary,
    ...extra,
  };
}

function blog(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Review ${id}`,
    url: extra.url || `https://books.example.com/review/${id}`,
    type: extra.type || "blog",
    summary,
    ...extra,
  };
}

function forum(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Thread ${id}`,
    url: extra.url || `https://reddit.com/r/RomanceBooks/comments/${id}/one`,
    type: extra.type || "forum",
    summary,
    ...extra,
  };
}

const PROTECT_TEXT = `${B} repeatedly protects ${HEROINE} and steps between her and danger.`;

describe("C.2.1 field coverage observability", () => {
  it("1. 3 supporting usable sources: count=3, evidencePoints=18, supportingSaturated=true", () => {
    const sources = [1, 2, 3].map((n) =>
      fandom(`g${n}`, PROTECT_TEXT)
    );
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.supportingEvidenceCount, 3);
    assert.equal(cov.coverageComponents.directEvidencePoints, 18);
    assert.equal(cov.supportingSaturated, true);
    const snap = compactFieldSnapshot(cov);
    assert.equal(snap.evidencePoints, 18);
    assert.equal(snap.supportingSaturated, true);
  });

  it("2. 5 supporting usable sources: count=5, evidencePoints still 18", () => {
    const sources = [1, 2, 3, 4, 5].map((n) =>
      fandom(`g${n}`, PROTECT_TEXT)
    );
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.supportingEvidenceCount, 5);
    assert.equal(cov.coverageComponents.directEvidencePoints, 18);
    assert.equal(cov.supportingSaturated, true);
    assert.equal(cov.supportingMarginalGainPossible, false);
    assert.equal(cov.stopQualitySatisfied, false);
  });

  it("3. 1 strong direct source: direct count and direct points", () => {
    const sources = [forum("d1", PROTECT_TEXT)];
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.directEvidenceCount, 1);
    assert.equal(cov.supportingEvidenceCount, 0);
    assert.equal(cov.coverageComponents.directEvidencePoints, 20);
    assert.equal(cov.directEvidenceSourceIds.length, 1);
    assert.equal(cov.supportingSaturated, false);
  });

  it("4. eligible source that is actually counted", () => {
    const source = blog("ok1", PROTECT_TEXT);
    const flow = buildJobSourceFlow({
      rawUrls: [source],
      mergedDraftsBeforeCap: [source],
      returnedFindings: [source],
      prepared: [source],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(flow.coverageEligibleCount, 1);
    assert.equal(flow.coverageContributingCount, 1);
    const cov = coverageOf(PROTECTIVE, [source]);
    const compared = compareEligibleVsCounted({
      field: PROTECTIVE,
      jobs: [{ targetFields: [PROTECTIVE], sourceFlow: flow }],
      coverage: cov,
      research: { sources: [source], seriesIdentity: leads },
      assessment: assessment({ evidenceSourceIds: [source.id] }),
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    assert.equal(compared.eligibleCount, 1);
    assert.equal(compared.actuallyCountedCount, 1);
    assert.equal(compared.countedDirectSourceIds.length, 1);
  });

  it("5. eligible source that does not match final field / identity: eligible > counted with reason", () => {
    const incoming = fandom("ident", PROTECT_TEXT, {
      url: "https://ember.fandom.com/wiki/Hero",
    });
    const identitySource = {
      id: "source-1",
      url: incoming.url,
      title: "Series pairing",
      type: "other",
      purpose: "identity",
      summary: "Confirmed romantic leads for the series.",
    };
    const flow = buildJobSourceFlow({
      prepared: [incoming],
      returnedFindings: [incoming],
      mergedDraftsBeforeCap: [incoming],
      rawUrls: [incoming],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(flow.coverageEligibleCount, 1);
    const merged = mergeAdaptiveSources([identitySource], [incoming]);
    assert.equal(merged.added.length, 0);
    assert.equal(merged.sources[0].purpose, "identity");
    const cov = coverageOf(PROTECTIVE, merged.sources);
    assert.equal(cov.directEvidenceCount + cov.supportingEvidenceCount, 0);
    const compared = compareEligibleVsCounted({
      field: PROTECTIVE,
      jobs: [{ targetFields: [PROTECTIVE], sourceFlow: flow }],
      coverage: cov,
      research: { sources: merged.sources, seriesIdentity: leads },
      assessment: assessment(),
      leadCharacters: leads,
      researchBefore: { sources: [identitySource] },
    });
    assert.ok(compared.eligibleCount > compared.actuallyCountedCount);
    assert.equal(compared.eligibleButNotCounted[0].reason, NOT_COUNTED_REASONS.IDENTITY_SOURCE);

    const unrelated = blog("wb1", "Court politics and a magic system.");
    const fakeJob = {
      targetFields: [PROTECTIVE],
      sourceFlow: {
        keySets: {
          coverageEligible: [sourceIdentityKey(unrelated)],
          coverageEligibleByField: {
            [PROTECTIVE]: [sourceIdentityKey(unrelated)],
          },
        },
      },
    };
    const emptyCov = coverageOf(PROTECTIVE, [unrelated]);
    const missed = compareEligibleVsCounted({
      field: PROTECTIVE,
      jobs: [fakeJob],
      coverage: emptyCov,
      research: { sources: [unrelated], seriesIdentity: leads },
      assessment: assessment(),
      leadCharacters: leads,
    });
    assert.ok(missed.eligibleCount > missed.actuallyCountedCount);
    assert.equal(
      missed.eligibleButNotCounted[0].reason,
      NOT_COUNTED_REASONS.NOT_LINKED_AND_NO_PHENOMENON_MATCH
    );
    const namedButUnrelated = blog(
      "named1",
      `${B} and ${HEROINE} discuss court politics and a magic system.`
    );
    assert.equal(
      diagnoseEligibleNotCounted({
        source: namedButUnrelated,
        field: PROTECTIVE,
        research: { sources: [namedButUnrelated], seriesIdentity: leads },
        assessment: assessment({ evidenceSourceIds: [namedButUnrelated.id] }),
        leadCharacters: leads,
      }),
      NOT_COUNTED_REASONS.NO_FINAL_PHENOMENON_MATCH
    );
  });

  it("6. same-domain sources: uniqueDomains is 1", () => {
    const sources = [
      fandom("a", PROTECT_TEXT, { url: "https://ember.fandom.com/wiki/A" }),
      fandom("b", PROTECT_TEXT, { url: "https://ember.fandom.com/wiki/B" }),
    ];
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.uniqueDomains, 1);
    assert.equal(compactFieldSnapshot(cov).uniqueDomains, 1);
  });

  it("7. study-guide-only critical field: needsStrongDirect=true, stopQuality=false", () => {
    const sources = [1, 2, 3, 4, 5].map((n) => fandom(`solo${n}`, PROTECT_TEXT));
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.stopQualitySatisfied, false);
    assert.equal(cov.needsStrongDirect, true);
    assert.equal(cov.sourceRoleMix.studyGuideCount, 5);
    assert.equal(cov.sourceRoleMix.readerExperienceCount, 0);
    assert.equal(
      criticalFieldStopQualitySatisfied({
        directSources: [],
        supportingSources: sources,
        score: 4,
      }),
      false
    );
  });

  it("8. strong direct + supporting: stopQuality semantics unchanged", () => {
    const direct = forum("sd1", PROTECT_TEXT);
    const support = fandom("sg1", PROTECT_TEXT);
    const cov = coverageOf(PROTECTIVE, [direct, support]);
    assert.ok(cov.directEvidenceCount >= 1);
    assert.ok(cov.supportingEvidenceCount >= 1);
    assert.equal(cov.stopQualitySatisfied, true);
    assert.equal(cov.needsStrongDirect, false);
    assert.equal(
      criticalFieldStopQualitySatisfied({
        directSources: [direct],
        supportingSources: [support],
        score: 4,
      }),
      true
    );
  });

  it("9. per-round before/after snapshot does not mutate coverage", () => {
    const beforeSources = [1, 2, 3].map((n) => fandom(`b${n}`, PROTECT_TEXT));
    const afterSources = [
      ...beforeSources,
      fandom("b4", PROTECT_TEXT),
      fandom("b5", PROTECT_TEXT),
    ];
    const coverageBefore = calculateResearchCoverage({
      assessments: { [PROTECTIVE]: assessment({ evidenceSourceIds: beforeSources.map((s) => s.id) }) },
      research: { sources: beforeSources, seriesIdentity: leads },
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    const coverageAfter = calculateResearchCoverage({
      assessments: { [PROTECTIVE]: assessment({ evidenceSourceIds: afterSources.map((s) => s.id) }) },
      research: { sources: afterSources, seriesIdentity: leads },
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    const frozenBefore = coverageBefore.fields[PROTECTIVE].coverageScore;
    const frozenAfter = coverageAfter.fields[PROTECTIVE].coverageScore;
    const frozenWeighted = coverageBefore.weightedCoverage;
    const jobs = [
      {
        targetFields: [PROTECTIVE],
        sourceFlow: buildJobSourceFlow({
          prepared: afterSources.slice(3),
          returnedFindings: afterSources.slice(3),
          mergedDraftsBeforeCap: afterSources.slice(3),
          rawUrls: afterSources.slice(3),
          targetFields: [PROTECTIVE],
          context: ctx(),
        }),
      },
    ];
    const obs = buildRoundFieldCoverageObservability({
      targetFields: [PROTECTIVE],
      coverageBefore,
      coverageAfter,
      jobs,
      researchAfter: { sources: afterSources, seriesIdentity: leads },
      researchBefore: { sources: beforeSources },
      assessments: { [PROTECTIVE]: assessment() },
    });
    assert.equal(coverageBefore.fields[PROTECTIVE].coverageScore, frozenBefore);
    assert.equal(coverageAfter.fields[PROTECTIVE].coverageScore, frozenAfter);
    assert.equal(coverageBefore.weightedCoverage, frozenWeighted);
    assert.equal(obs.fieldSnapshotsBefore[0].supportingEvidenceCount, 3);
    assert.equal(obs.fieldSnapshotsAfter[0].supportingEvidenceCount, 5);
    assert.equal(obs.fieldSnapshotsAfter[0].evidencePoints, 18);
    assert.equal(obs.fieldCoverageSummary.fields[0].supportingSaturated, true);
    obs.fieldSnapshotsBefore[0].coverage = -1;
    assert.equal(coverageBefore.fields[PROTECTIVE].coverageScore, frozenBefore);
  });

  it("10. weighted coverage unchanged when diagnostics are attached", () => {
    const sources = [forum("w1", PROTECT_TEXT), fandom("w2", PROTECT_TEXT)];
    const assessments = Object.fromEntries(
      SUBJECTIVE_KEYS.map((field) => [
        field,
        assessment({
          evidenceSourceIds: field === PROTECTIVE ? sources.map((s) => s.id) : [],
        }),
      ])
    );
    const a = calculateResearchCoverage({
      assessments,
      research: { sources, seriesIdentity: leads },
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    const b = calculateResearchCoverage({
      assessments,
      research: { sources, seriesIdentity: leads },
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    assert.equal(a.weightedCoverage, b.weightedCoverage);
    let weightedSum = 0;
    let weightTotal = 0;
    for (const field of SUBJECTIVE_KEYS) {
      const w = getTineFieldWeight(field);
      weightedSum += a.fields[field].coverageScore * w;
      weightTotal += w;
      assert.equal(
        a.fields[field].coverageComponents.totalCoverage,
        a.fields[field].coverageScore
      );
    }
    assert.equal(a.weightedCoverage, Math.round(weightedSum / weightTotal));
    const snap = compactFieldSnapshot(a.fields[PROTECTIVE]);
    snap.coverage = 0;
    assert.equal(a.fields[PROTECTIVE].coverageScore, b.fields[PROTECTIVE].coverageScore);
  });

  it("11. C.1 fallback behavior unchanged", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: {
        id: "followup-hero_protective_dynamic-r1-1",
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE],
        batchHint: "helteprofil",
        userPrompt: "Find reader evidence.",
        queryHints: ['"The Ember Cycle" protective'],
        leadCharacters: leads,
      },
      identity: { title: "The Ember Cycle", series: "The Ember Cycle" },
      remainingSearchCalls: 6,
      client: {},
      runSearch: async () => {
        calls += 1;
        return {
          findings: [],
          rawUrls: [],
          rawUrlCount: 0,
          webSearchCalls: 1,
          parseStatus: "structured",
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.fallbackTriggered, true);
  });

  it("12. C.1.3 field-aware quality unchanged", () => {
    const source = fandom("q1", PROTECT_TEXT);
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    const q = evaluateEvidenceQualityForField({
      source,
      field: PROTECTIVE,
      relevance: ev.relevance,
    });
    assert.equal(q.eligible, true);
    assert.equal(q.qualityTier, "usable");
    assert.equal(q.coverageBucket, "supporting");
    assert.equal(ADAPTIVE_VERSION, "adaptive-v11");
  });

  it("13. B.1.3 subject guard unchanged", () => {
    const source = blog(
      "alt",
      `${ALT} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, true);
    assert.equal(classified.subjectValid, false);
    assert.equal(classified.coverageEligible, false);
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    assert.equal(isFieldSpecificEvidence(ev), false);
  });

  it("14. initial 4-batch behavior unchanged", () => {
    const plan = buildSearchPlan({
      title: "The Ember Cycle",
      author: "A. Writer",
    });
    assert.equal(plan.length, 4);
    assert.deepEqual(
      plan.map((p) => p.id),
      ["helteprofil", "romanceprofil", "plotkarakter", "helhed"]
    );
    assert.equal(ADAPTIVE_VERSION, "adaptive-v11");
    assert.equal(BENCHMARK_VERSION, "benchmark-v7");
  });

  it("coverageComponents reuse the production points (no parallel formula)", () => {
    const cov = coverageOf(PROTECTIVE, [forum("p1", PROTECT_TEXT)]);
    assert.equal(cov.coverageComponents.directEvidencePoints, cov.components.directEvidence);
    assert.equal(cov.coverageComponents.confidenceBasisPoints, cov.components.confidenceBasis);
    assert.equal(cov.coverageComponents.sourceIndependencePoints, cov.components.sourceIndependence);
    assert.equal(cov.coverageComponents.evidenceSpecificityPoints, cov.components.evidenceSpecificity);
    assert.equal(cov.coverageComponents.readerDiversityPoints, cov.components.readerDiversity);
    assert.equal(cov.coverageComponents.totalCoverage, cov.coverageScore);
  });

  it("critical handbook fields get generic snapshots without series-specific hardcoding", () => {
    const source = forum("crit", PROTECT_TEXT);
    for (const field of [PROTECTIVE, BODYGUARD, THAD, RHYSAND, FMC_DEV, HANGOVER]) {
      const cov = coverageOf(field, [source]);
      const snap = compactFieldSnapshot(cov);
      assert.equal(snap.field, field);
      assert.ok(Array.isArray(snap.gapReasons));
      assert.ok(snap.coverageComponents || snap.evidencePoints != null);
    }
  });
});

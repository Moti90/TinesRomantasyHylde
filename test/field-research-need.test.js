import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  calculateFieldCoverage,
  calculateResearchCoverage,
  planFollowUpResearch,
} from "../server/services/adaptiveResearch.js";
import {
  classifyFieldResearchNeed,
  classifySourceMixOutcome,
  countSourceRoleMix,
  NEED_TYPES,
  RETRIEVAL_MODES,
  selectGroupRetrievalMode,
} from "../server/services/fieldResearchNeed.js";
import {
  buildRetrievalApproaches,
  flattenRetrievalApproaches,
} from "../server/services/searchRetrieval.js";
import {
  compareEligibleVsCounted,
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
import { buildSearchPlan } from "../server/services/webResearch.js";
import {
  ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS,
  ADAPTIVE_MAX_SOURCES_PER_JOB,
  ADAPTIVE_VERSION,
} from "../server/services/versions.js";
import { BENCHMARK_VERSION } from "../server/services/researchBenchmark.js";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const HANGOVER = "Book hangover (0-5)";
const WORLD = "Worldbuilding (0-5)";
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

const unresolvedLeads = {
  mmc: "",
  fmc: "",
  confidence: "low",
  resolution: { resolved: false, reason: "unresolved" },
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

function assessmentsFor(map = {}) {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((k) => [k, assessment({ score: 3, ...(map[k] || {}) })])
  );
}

function coverageOf(field, sources, extra = {}) {
  return calculateFieldCoverage({
    field,
    assessment: assessment({
      evidenceSourceIds: sources.map((s) => s.id).filter(Boolean),
      ...extra.assessment,
    }),
    research: { sources, seriesIdentity: extra.leads || leads },
    identity: { title: "The Ember Cycle" },
    leadCharacters: extra.leads || leads,
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

describe("C.3 strong direct source mix", () => {
  it("1. supporting-only critical behavior field → needs_direct", () => {
    const sources = [fandom("s1", PROTECT_TEXT), fandom("s2", PROTECT_TEXT)];
    const cov = coverageOf(PROTECTIVE, sources);
    assert.ok(cov.supportingEvidenceCount >= 1);
    assert.equal(cov.directEvidenceCount, 0);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.needType, NEED_TYPES.NEEDS_DIRECT);
    assert.equal(need.fieldClass, "behavior");
  });

  it("2. supporting saturated + no direct → reader_direct/scene_direct", () => {
    const sources = [1, 2, 3].map((n) => fandom(`sat${n}`, PROTECT_TEXT));
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.supportingSaturated, true);
    assert.equal(cov.needsStrongDirect, true);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.needType, NEED_TYPES.SUPPORTING_SATURATED);
    assert.ok(
      [RETRIEVAL_MODES.READER_DIRECT, RETRIEVAL_MODES.SCENE_DIRECT].includes(
        need.preferredRetrievalMode
      )
    );
    const mode = selectGroupRetrievalMode([need]);
    assert.equal(mode, RETRIEVAL_MODES.READER_DIRECT);
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle" },
      research: { sources, seriesIdentity: leads },
      assessments: assessmentsFor({
        [PROTECTIVE]: assessment({
          evidenceSourceIds: sources.map((s) => s.id),
        }),
      }),
      coverage: calculateResearchCoverage({
        assessments: assessmentsFor({
          [PROTECTIVE]: assessment({
            evidenceSourceIds: sources.map((s) => s.id),
          }),
        }),
        research: { sources, seriesIdentity: leads },
        identity: { title: "The Ember Cycle" },
        leadCharacters: leads,
      }),
    });
    const protective = jobs.find((j) => j.strategy === "hero_protective_dynamic");
    assert.ok(protective);
    assert.ok(
      [RETRIEVAL_MODES.READER_DIRECT, RETRIEVAL_MODES.SCENE_DIRECT].includes(
        protective.retrievalMode
      )
    );
    assert.match(
      protective.userPrompt,
      /Retrieval instruction prioritizes reader\/forum\/review|concrete scene/i
    );
  });

  it("3. resolved field → no strong-direct retrieval escalation", () => {
    const direct = forum("rd1", PROTECT_TEXT);
    const support = [
      forum("rd2", `${B} keeps ${HEROINE} safe and acts like a bodyguard.`),
      forum("rd3", `${B} goes feral whenever ${HEROINE} is threatened.`),
    ];
    const sources = [direct, ...support];
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.stopQualitySatisfied, true);
    assert.equal(cov.needsStrongDirect, false);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.needType, NEED_TYPES.RESOLVED);

    const strongIds = sources.map((s) => s.id);
    const assessments = assessmentsFor(
      Object.fromEntries(
        [PROTECTIVE, BODYGUARD, THAD].map((field) => [
          field,
          assessment({
            evidenceSourceIds: strongIds,
            confidence: "high",
            basis: "source_consensus",
          }),
        ])
      )
    );
    const coverage = calculateResearchCoverage({
      assessments,
      research: { sources, seriesIdentity: leads },
      identity: { title: "The Ember Cycle" },
      leadCharacters: leads,
    });
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle" },
      research: { sources, seriesIdentity: leads },
      assessments,
      coverage,
    });
    const protectiveJob = jobs.find((j) => j.strategy === "hero_protective_dynamic");
    if (protectiveJob) {
      assert.equal(protectiveJob.targetFields.includes(PROTECTIVE), false);
    }
  });

  it("4. reader-experience field without reader sources → needs_reader_evidence", () => {
    const sources = [
      fandom("hang1", "A long character list and plot synopsis."),
    ];
    const cov = coverageOf(HANGOVER, sources);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.needType, NEED_TYPES.NEEDS_READER_EVIDENCE);
    assert.equal(need.readerDeficit, true);
    assert.equal(need.preferredRetrievalMode, RETRIEVAL_MODES.READER_DIRECT);
  });

  it("5. reader-experience field with Reddit/GR evidence → reader deficit false", () => {
    const sources = [
      forum(
        "hang2",
        "Serious book hangover; I couldn't put the book down."
      ),
    ];
    const cov = coverageOf(HANGOVER, sources);
    assert.ok((cov.sourceRoleMix?.readerExperienceCount || 0) >= 1);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.readerDeficit, false);
    assert.notEqual(need.needType, NEED_TYPES.NEEDS_READER_EVIDENCE);
  });

  it("6. behavior field with strong direct → needsStrongDirect false", () => {
    const sources = [forum("sd1", PROTECT_TEXT)];
    const cov = coverageOf(PROTECTIVE, sources);
    assert.ok(cov.directEvidenceCount >= 1);
    assert.equal(cov.needsStrongDirect, false);
    assert.equal(cov.stopQualitySatisfied, true);
    const need = classifyFieldResearchNeed(cov);
    assert.equal(need.needType, NEED_TYPES.RESOLVED);
  });

  it("7. generic narrative/worldbuilding field is not forced reader_direct", () => {
    const cov = coverageOf(WORLD, []);
    const need = classifyFieldResearchNeed({ ...cov, field: WORLD });
    assert.equal(need.fieldClass, "narrative");
    assert.notEqual(need.preferredRetrievalMode, RETRIEVAL_MODES.READER_DIRECT);
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: leads,
      targetFields: [WORLD],
      strategy: "plot_worldbuilding",
      retrievalMode: need.preferredRetrievalMode,
    });
    assert.equal(approaches.retrievalMode, RETRIEVAL_MODES.GENERAL);
  });

  it("8. unresolved identity keeps generic lead wording", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: unresolvedLeads,
      targetFields: [PROTECTIVE],
      strategy: "hero_protective_dynamic",
      retrievalMode: RETRIEVAL_MODES.SCENE_DIRECT,
    });
    const blob = JSON.stringify(approaches);
    assert.equal(approaches.named, false);
    assert.match(blob, /central male romantic lead|the heroine/i);
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle", series: "The Ember Cycle", isSeries: true },
      research: { sources: [] },
      assessments: assessmentsFor({
        [PROTECTIVE]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      }),
    });
    assert.ok(jobs.length >= 1);
    assert.match(
      jobs[0].queryHints.join(" "),
      /main romantic lead heroine|eventual romantic partner|central male romantic lead/i
    );
  });

  it("9. resolved identity uses MMC/FMC names", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: leads,
      targetFields: [PROTECTIVE],
      strategy: "hero_protective_dynamic",
      retrievalMode: RETRIEVAL_MODES.READER_DIRECT,
    });
    const blob = JSON.stringify(approaches);
    assert.equal(approaches.named, true);
    assert.match(blob, new RegExp(B));
    assert.match(blob, new RegExp(HEROINE));
    assert.equal(/the series' central male romantic lead/i.test(blob), false);
  });

  it("10. C.1 fallback still max 1", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: {
        id: "followup-hero_protective_dynamic-r1-1",
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE],
        retrievalMode: RETRIEVAL_MODES.READER_DIRECT,
        batchHint: "helteprofil",
        userPrompt: "Find reader evidence.",
        queryHints: ['"The Ember Cycle" protective'],
        leadCharacters: leads,
      },
      identity: { title: "The Ember Cycle" },
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

  it("11. search budget unchanged", () => {
    assert.equal(ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS, 6);
  });

  it("12. cap=8 unchanged", () => {
    assert.equal(ADAPTIVE_MAX_SOURCES_PER_JOB, 8);
  });

  it("13. B.1.3 wrong-subject guard unchanged", () => {
    const source = {
      url: "https://blog.example.com/alt",
      type: "blog",
      summary: `${ALT} repeatedly protects ${HEROINE} and steps between her and danger.`,
    };
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

  it("14. C.1.3 quality unchanged", () => {
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
  });

  it("15. C.2.1 eligible→counted diagnostics unchanged", () => {
    const source = {
      id: "ok1",
      title: "Review",
      url: "https://books.example.com/review/ok1",
      type: "blog",
      summary: PROTECT_TEXT,
    };
    const flow = buildJobSourceFlow({
      prepared: [source],
      returnedFindings: [source],
      mergedDraftsBeforeCap: [source],
      rawUrls: [source],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    const cov = coverageOf(PROTECTIVE, [source]);
    const compared = compareEligibleVsCounted({
      field: PROTECTIVE,
      jobs: [{ targetFields: [PROTECTIVE], sourceFlow: flow }],
      coverage: cov,
      research: { sources: [source], seriesIdentity: leads },
      assessment: assessment({ evidenceSourceIds: [source.id] }),
      leadCharacters: leads,
    });
    assert.equal(compared.eligibleCount, 1);
    assert.equal(compared.actuallyCountedCount, 1);
  });

  it("16. source-role observability", () => {
    const guides = [1, 2, 3].map((n) => fandom(`mix${n}`, PROTECT_TEXT));
    const cov = coverageOf(PROTECTIVE, guides);
    assert.equal(cov.sourceRoleMix.studyGuideCount, 3);
    assert.equal(cov.sourceRoleMix.readerExperienceCount, 0);
    const mix = countSourceRoleMix([
      forum("r1", PROTECT_TEXT),
      fandom("g1", PROTECT_TEXT),
    ]);
    assert.equal(mix.readerExperienceCount, 1);
    assert.equal(mix.studyGuideCount, 1);
    assert.equal(
      classifySourceMixOutcome({
        preparedCount: 3,
        newStrongDirectCount: 1,
      }),
      "strong_direct_recovered"
    );
    assert.equal(
      classifySourceMixOutcome({
        retrievalStatus: "retrieval_zero",
        preparedCount: 0,
      }),
      "zero_retrieval"
    );
  });

  it("17. no hardcoded series/person names in new production modules", () => {
    const files = [
      "server/services/fieldResearchNeed.js",
      "server/services/retrievalModes.js",
    ];
    const banned = /\b(ACOTAR|Feyre|Tamlin|Rhysand|Nesta|Cassian)\b/;
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      assert.equal(banned.test(text), false, rel);
    }
  });

  it("18. initial 4-batch unchanged", () => {
    const plan = buildSearchPlan({
      title: "The Ember Cycle",
      author: "A. Writer",
    });
    assert.equal(plan.length, 4);
    assert.deepEqual(
      plan.map((p) => p.id),
      ["helteprofil", "romanceprofil", "plotkarakter", "helhed"]
    );
    assert.equal(ADAPTIVE_VERSION, "adaptive-v13");
    assert.equal(BENCHMARK_VERSION, "benchmark-v7");
  });

  it("READER_DIRECT flatten prefers discussion/reader over trope", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: leads,
      targetFields: [PROTECTIVE],
      strategy: "hero_protective_dynamic",
      retrievalMode: RETRIEVAL_MODES.READER_DIRECT,
    });
    const hints = flattenRetrievalApproaches(approaches, RETRIEVAL_MODES.READER_DIRECT);
    const blob = hints.join(" ");
    assert.match(blob, /reddit|goodreads|review|readers describe/i);
    assert.equal(approaches.retrievalMode, RETRIEVAL_MODES.READER_DIRECT);
  });

  it("stopQuality helper unchanged for study-guide-only vs strong direct", () => {
    const guide = fandom("solo", PROTECT_TEXT);
    assert.equal(
      criticalFieldStopQualitySatisfied({
        directSources: [],
        supportingSources: [guide],
        score: 4,
      }),
      false
    );
    assert.equal(
      criticalFieldStopQualitySatisfied({
        directSources: [forum("d", PROTECT_TEXT)],
        supportingSources: [guide],
        score: 4,
      }),
      true
    );
  });
});

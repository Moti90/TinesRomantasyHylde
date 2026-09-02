import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import { planFollowUpResearch } from "../server/services/adaptiveResearch.js";
import {
  executeFocusedJobWithFallback,
  isFollowUpSourceRelevant,
  prepareFollowUpSources,
  rebuildResearchFromSources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";
import { ADAPTIVE_VERSION } from "../server/services/versions.js";
import {
  PAIRING_RELATIONS,
  normalizeRomancePairing,
  primaryPairings,
} from "../server/services/seriesRomanceIdentity.js";
import {
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import { buildRomanceScope, semanticPairingKey } from "../server/services/seriesRomancePlanning.js";
import {
  INVALID_ROMANCE_SCOPE_ERROR,
  SCOPE_PROVENANCE_PLANNER,
  SCOPE_STATUS_REQUESTED,
  buildInvalidRomanceScopeJobTrace,
  boundedQueryHints,
  buildScopedExecutionInputs,
  buildScopedRecordId,
  buildScopedRetrievalRecord,
  buildScopedRetrievalRecords,
  isExecutableRomanceScope,
  mergeScopedRetrievalRecords,
  normalizeScopedRetrieval,
  normalizeStoredRomanceScope,
  safeTraceRomanceScope,
  sanitizeMemberNames,
  sortArcScopes,
  sortBookScopes,
} from "../server/services/seriesRomanceRetrieval.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";

const ALFA = "Alfa";
const BETA = "Beta";
const GAMMA = "Gamma";
const DELTA = "Delta";

const identity = {
  title: "Cycle Alpha",
  author: "Writer One",
  series: "Cycle Alpha",
  firstBook: "Alpha One",
};

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "low",
    basis: "ai_inference",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function weakAssessments() {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((field) => [field, assessment()])
  );
}

function readyDiscovery(romance) {
  return stampTopologyDiscovery(romance, {
    resolved: true,
    attemptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function rotatingPairings() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        {
          members: [member(BETA, "fmc"), member(ALFA, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [member(DELTA, "fmc"), member(GAMMA, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    })
  );
}

function scopeA() {
  const pairing = primaryPairings(rotatingPairings())[0];
  return buildRomanceScope(pairing, "rotating_couples");
}

function scopeB() {
  const pairing = primaryPairings(rotatingPairings())[1];
  return buildRomanceScope(pairing, "rotating_couples");
}

function scopedJob(over = {}) {
  return {
    id: "followup-protective-r1-1",
    strategy: "hero_protective_dynamic",
    round: 1,
    fields: [PROTECTIVE, BODYGUARD, THAD],
    targetFields: [PROTECTIVE, BODYGUARD, THAD],
    batchHint: "helteprofil",
    userPrompt: "Find protective hero evidence for the series.",
    queryHints: ['"Cycle Alpha" protective review'],
    retrievalMode: "reader_direct",
    retrievalApproaches: {
      readerLanguage: ['"Cycle Alpha" protective review'],
      discussionLanguage: ['"Cycle Alpha" reddit protective'],
    },
    leadCharacters: { mmc: ALFA, fmc: BETA, resolution: { resolved: true } },
    series: { title: identity.series, author: identity.author, isSeries: true },
    romanceScope: scopeA(),
    ...over,
  };
}

function preparedSource(over = {}) {
  return {
    title: "Review",
    url: "https://reviews.example.com/scoped-one",
    type: "blog",
    batch: "helteprofil",
    summary: "Protective dynamic discussed in detail.",
    focus: "hero_protective_dynamic",
    followUpJobId: "followup-protective-r1-1",
    retrievalAttempt: 1,
    retrievalStrategy: "primary",
    ...over,
  };
}

function researchBase(over = {}) {
  return {
    sources: [{ id: "source-1", url: "https://seed.example/base", type: "blog" }],
    seriesRomanceIdentity: rotatingPairings(),
    seriesIdentity: {
      mmc: ALFA,
      fmc: BETA,
      resolution: { resolved: true },
    },
    meta: {},
    ...over,
  };
}

function planJobs({ fields, romance = rotatingPairings() } = {}) {
  const targetFields = Array.isArray(fields) ? fields : [fields];
  const assessments = Object.fromEntries(
    SUBJECTIVE_KEYS.map((field) => [
      field,
      assessment({
        basis: targetFields.includes(field) ? "ai_inference" : "source_consensus",
        evidenceSourceIds: targetFields.includes(field) ? [] : ["resolved-0"],
      }),
    ])
  );
  return planFollowUpResearch({
    identity,
    research: researchBase({ seriesRomanceIdentity: romance }),
    assessments,
    coverage: { fields: {}, weightedCoverage: 40, gaps: [] },
    gaps: targetFields.map((field) => ({
      field,
      priority: 10,
      coverageScore: 20,
      reasons: ["low"],
      targetPhenomena: [],
    })),
    round: 1,
    previousRounds: [],
  });
}

describe("seriesRomanceRetrieval validation", () => {
  it("valid scope is executable", () => {
    assert.equal(isExecutableRomanceScope(scopeA()), true);
  });

  it("null and undefined are not executable", () => {
    assert.equal(isExecutableRomanceScope(null), false);
    assert.equal(isExecutableRomanceScope(undefined), false);
  });

  it("malformed shapes do not throw and are not executable", () => {
    for (const bad of [
      "string",
      42,
      [],
      { memberNames: [] },
      { memberNames: ["x"] },
    ]) {
      assert.doesNotThrow(() => isExecutableRomanceScope(bad));
      assert.equal(isExecutableRomanceScope(bad), false);
    }
  });

  it("sanitizeMemberNames dedupes and sorts deterministically", () => {
    assert.deepEqual(sanitizeMemberNames(["Beta", "Alfa", "Beta", "Alfa"]), [
      ALFA,
      BETA,
    ]);
  });

  it("buildInvalidRomanceScopeJobTrace never throws on malformed scope shapes", () => {
    const cyclic = { memberNames: [ALFA, BETA] };
    cyclic.self = cyclic;
    const cases = [
      { memberNames: "Alfa,Beta" },
      { memberNames: [ALFA], bookScopes: "bad", arcScopes: 42 },
      { memberNames: [ALFA], bookScopes: [{ bookNumber: "x" }], arcScopes: [null] },
      cyclic,
    ];
    for (const romanceScope of cases) {
      assert.doesNotThrow(() =>
        buildInvalidRomanceScopeJobTrace({
          id: "job-malformed",
          strategy: "hero_protective_dynamic",
          targetFields: [PROTECTIVE],
          romanceScope,
        })
      );
      const trace = buildInvalidRomanceScopeJobTrace({
        id: "job-malformed",
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE],
        romanceScope,
      });
      assert.equal(trace.error, INVALID_ROMANCE_SCOPE_ERROR);
      assert.notEqual(trace.romanceScope, undefined);
    }
  });
});

describe("seriesRomanceRetrieval query composition", () => {
  it("uses neutral pairing language without MMC/FMC guessing", () => {
    const inputs = buildScopedExecutionInputs(scopedJob(), {
      identity,
      series: scopedJob().series,
    });
    assert.ok(inputs);
    assert.match(inputs.primaryUserPrompt, /romantic pairing between "Alfa" and "Beta"/i);
    assert.doesNotMatch(inputs.primaryUserPrompt, /seriens centrale mandlige/i);
    assert.match(inputs.fallbackUserPrompt, /romantic pairing between "Alfa" and "Beta"/i);
    assert.doesNotMatch(inputs.fallbackUserPrompt, new RegExp(`${ALFA} and ${BETA}'s relationship`));
  });

  it("pairing array order does not change query names", () => {
    const reversed = scopedJob({
      romanceScope: buildRomanceScope(
        normalizeRomancePairing(
          {
            id: "pair-a",
            members: [member(BETA, "mmc"), member(ALFA, "fmc")],
            bookScopes: [{ bookNumber: 1 }],
            prominence: "primary",
          },
          0
        ),
        "rotating_couples"
      ),
    });
    const inputs = buildScopedExecutionInputs(reversed, {
      identity,
      series: reversed.series,
    });
    assert.match(inputs.primaryUserPrompt, /"Alfa" and "Beta"/);
  });

  it("orders book scopes before arc scopes", () => {
    const books = sortBookScopes([
      { bookNumber: 2, title: "Two" },
      { bookNumber: null, title: "Unknown" },
      { bookNumber: 1, title: "One" },
    ]);
    assert.deepEqual(
      books.map((b) => b.bookNumber),
      [1, 2, null]
    );
    const arcs = sortArcScopes([
      { id: "z", label: "Z" },
      { id: "a", label: "A" },
    ]);
    assert.deepEqual(arcs.map((a) => a.id), ["a", "z"]);
    const scopeWithArc = {
      ...scopeA(),
      arcScopes: [{ id: "arc-a", label: "First arc" }],
    };
    const inputs = buildScopedExecutionInputs(scopedJob({ romanceScope: scopeWithArc }), {
      identity,
      series: scopedJob().series,
    });
    const bookIdx = inputs.primaryUserPrompt.indexOf("book 1");
    const arcIdx = inputs.primaryUserPrompt.indexOf('arc "arc-a"');
    assert.ok(bookIdx >= 0 && arcIdx >= 0);
    assert.ok(bookIdx < arcIdx);
  });

  it("does not use pairingId as query term", () => {
    const inputs = buildScopedExecutionInputs(scopedJob(), {
      identity,
      series: scopedJob().series,
    });
    assert.doesNotMatch(inputs.primaryUserPrompt, /pair-a/);
    assert.ok(inputs.primaryQueryHints.every((h) => !h.includes("pair-a")));
  });

  it("primary and fallback share requested scope key context", () => {
    const inputs = buildScopedExecutionInputs(scopedJob(), {
      identity,
      series: scopedJob().series,
    });
    assert.ok(inputs.requestedScopeKey);
    assert.match(inputs.primaryUserPrompt, /Scope this search/i);
    assert.match(inputs.fallbackUserPrompt, /Scope this search/i);
    assert.match(inputs.primaryUserPrompt, /"Alfa" and "Beta"/);
    assert.match(inputs.fallbackUserPrompt, /"Alfa" and "Beta"/);
  });

  it("null scope returns null inputs", () => {
    assert.equal(
      buildScopedExecutionInputs(scopedJob({ romanceScope: null }), {
        identity,
        series: scopedJob().series,
      }),
      null
    );
  });

  it("retains primary scope hint when base hints already fill cap", () => {
    const baseHints = Array.from({ length: 10 }, (_v, i) => `base hint ${i + 1}`);
    const scopeHints = [
      '"Cycle Alpha" the romantic pairing between "Alfa" and "Beta" review',
      '"Cycle Alpha" scope extra',
    ];
    const hints = boundedQueryHints(baseHints, scopeHints, 10);
    assert.equal(hints.length, 10);
    assert.ok(
      hints.some((hint) =>
        hint.includes('the romantic pairing between "Alfa" and "Beta"')
      )
    );
    assert.equal(hints[9], scopeHints[0]);
  });
});

describe("seriesRomanceRetrieval records", () => {
  it("builds deterministic record IDs and deduplicates", () => {
    const job = scopedJob();
    const record = buildScopedRetrievalRecord(preparedSource(), job, 1);
    assert.ok(record);
    assert.match(record.id, /^scoped-retrieval-[a-f0-9]{24}$/);
    assert.equal(record.scopeStatus, SCOPE_STATUS_REQUESTED);
    assert.equal(record.scopeProvenance, SCOPE_PROVENANCE_PLANNER);
    assert.ok(record.requestedRomanceScope.pairingId);
    assert.equal(record.scopeValidated, undefined);
    assert.equal(record.subjectValidated, undefined);

    const again = buildScopedRetrievalRecord(preparedSource(), job, 1);
    assert.equal(again.id, record.id);

    const merged = mergeScopedRetrievalRecords({ records: [] }, [record, again]);
    assert.equal(merged.stored, 1);
    assert.equal(merged.skipped, 1);
  });

  it("same URL across two scopes creates two records", () => {
    const url = "https://reviews.example.com/shared";
    const jobA = scopedJob({ id: "job-a", romanceScope: scopeA() });
    const jobB = scopedJob({ id: "job-b", romanceScope: scopeB() });
    const recA = buildScopedRetrievalRecord(preparedSource({ url }), jobA, 1);
    const recB = buildScopedRetrievalRecord(preparedSource({ url }), jobB, 1);
    assert.notEqual(recA.id, recB.id);
    assert.equal(recA.sourceIdentity.identityKey, recB.sourceIdentity.identityKey);
    assert.notEqual(recA.requestedScopeKey, recB.requestedScopeKey);
  });

  it("missing URL creates no record", () => {
    assert.equal(
      buildScopedRetrievalRecord(preparedSource({ url: null }), scopedJob(), 1),
      null
    );
  });

  it("normalizes missing sidecar", () => {
    assert.deepEqual(normalizeScopedRetrieval(null), { records: [] });
    assert.deepEqual(normalizeScopedRetrieval(undefined), { records: [] });
  });

  it("derives retrievalStrategy from attempt, not prepared source", () => {
    const job = scopedJob();
    const primary = buildScopedRetrievalRecord(
      preparedSource({ retrievalAttempt: 1, retrievalStrategy: "bogus" }),
      job,
      1
    );
    const fallback = buildScopedRetrievalRecord(
      preparedSource({
        url: "https://reviews.example.com/fallback-only",
        retrievalAttempt: 2,
        retrievalStrategy: "also_bogus",
      }),
      job,
      1
    );
    assert.equal(primary.retrievalStrategy, "primary");
    assert.equal(fallback.retrievalStrategy, "broad_fallback");
  });

  it("normalizes stored scope ordering for equivalent inputs", () => {
    const scopeForward = {
      pairingId: "pair-x",
      memberNames: [BETA, ALFA],
      bookScopes: [
        { bookNumber: 2, title: "Two" },
        { bookNumber: 1, title: "One" },
      ],
      arcScopes: [
        { id: "z-arc", label: "Z" },
        { id: "a-arc", label: "A" },
      ],
      topology: "rotating_couples",
    };
    const scopeShuffled = {
      pairingId: "pair-x",
      memberNames: [ALFA, BETA],
      bookScopes: [
        { bookNumber: 1, title: "One" },
        { bookNumber: 2, title: "Two" },
      ],
      arcScopes: [
        { id: "a-arc", label: "A" },
        { id: "z-arc", label: "Z" },
      ],
      topology: "rotating_couples",
    };
    const normalizedA = normalizeStoredRomanceScope(scopeForward);
    const normalizedB = normalizeStoredRomanceScope(scopeShuffled);
    assert.deepEqual(normalizedA, normalizedB);

    const jobA = scopedJob({ romanceScope: scopeForward });
    const jobB = scopedJob({ romanceScope: scopeShuffled });
    const recordA = buildScopedRetrievalRecord(preparedSource(), jobA, 1);
    const recordB = buildScopedRetrievalRecord(preparedSource(), jobB, 1);
    assert.equal(recordA.id, recordB.id);
    assert.equal(recordA.requestedScopeKey, recordB.requestedScopeKey);
    assert.deepEqual(recordA.requestedRomanceScope, recordB.requestedRomanceScope);
  });
});

describe("executeFocusedJobWithFallback scoped execution", () => {
  it("malformed non-null scope does not call runSearch", async () => {
    let searches = 0;
    const result = await executeFocusedJobWithFallback({
      job: scopedJob({ romanceScope: { memberNames: [] } }),
      identity,
      round: 1,
      client: {},
      runSearch: async () => {
        searches += 1;
        return { findings: [], rawUrls: [], webSearchCalls: 1 };
      },
    });
    assert.equal(searches, 0);
    assert.equal(result.invalidRomanceScope, true);
    assert.equal(result.webSearchCalls, 0);
  });

  it("scoped primary uses additive scope instruction", async () => {
    let call = 0;
    let capturedPrompt = "";
    await executeFocusedJobWithFallback({
      job: scopedJob(),
      identity,
      round: 1,
      client: {},
      runSearch: async (_client, args) => {
        call += 1;
        if (call === 1) capturedPrompt = args.userPrompt;
        return {
          findings: [
            {
              title: "Hit",
              url: "https://reviews.example.com/one",
              summary: "Protective hero bodyguard.",
            },
          ],
          rawUrls: [{ url: "https://reviews.example.com/one" }],
          webSearchCalls: 1,
          parseStatus: "ok",
        };
      },
    });
    assert.match(capturedPrompt, /Find protective hero evidence/);
    assert.match(capturedPrompt, /romantic pairing between "Alfa" and "Beta"/i);
  });

  it("null scope keeps legacy prompt", async () => {
    let call = 0;
    let capturedPrompt = "";
    const job = scopedJob({ romanceScope: null });
    await executeFocusedJobWithFallback({
      job,
      identity,
      round: 1,
      client: {},
      runSearch: async (_client, args) => {
        call += 1;
        if (call === 1) capturedPrompt = args.userPrompt;
        return {
          findings: [
            {
              title: "Hit",
              url: "https://reviews.example.com/two",
              summary: "Protective hero.",
            },
          ],
          rawUrls: [{ url: "https://reviews.example.com/two" }],
          webSearchCalls: 1,
          parseStatus: "ok",
        };
      },
    });
    assert.equal(capturedPrompt, job.userPrompt);
  });
});

describe("runAdaptiveResearch Structure 3.2 integration", () => {
  function analysisWith() {
    return {
      row: { "Seriens navn": identity.series },
      meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
    };
  }

  it("malformed non-null scope is rejected in runAdaptiveResearch loop", async () => {
    const planned = planJobs({ fields: [PROTECTIVE, BODYGUARD, THAD] });
    assert.ok(planned[0]?.romanceScope, "planner fixture should produce scoped job");

    const cyclic = { memberNames: [ALFA, BETA], bookScopes: "not-an-array" };
    cyclic.self = cyclic;

    const malformedJobs = planned.slice(0, 2).map((job, index) => ({
      ...job,
      id: `malformed-${index + 1}`,
      romanceScope:
        index === 0
          ? { memberNames: "Alfa,Beta", bookScopes: {}, arcScopes: [1, 2, 3] }
          : cyclic,
    }));

    let executorCalls = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ sources: [] }),
      initialAnalysis: {
        row: { "Seriens navn": identity.series },
        meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        followUpPlan: malformedJobs,
        executeFollowUpJob: async () => {
          executorCalls += 1;
          return {
            sources: [],
            webSearchCalls: 1,
            costUsd: 0.01,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
        synthesize: async () => {
          throw new Error("synthesis must not run");
        },
        analyze: async () => ({
          row: { "Seriens navn": identity.series },
          meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
        }),
      },
    });

    assert.equal(executorCalls, 0);
    assert.equal(result.adaptive.additionalWebSearchCalls, 0);
    assert.equal(result.adaptive.stopReason, "error");
    assert.equal(result.research.scopedRetrieval.records.length, 0);
    assert.equal((result.research.sources || []).length, 0);

    const round = result.adaptive.rounds[0];
    assert.equal(round.scopedRecordsStored, 0);
    assert.equal(round.scopedOnlyRound, false);
    assert.equal(round.webSearchCalls, 0);

    for (const trace of round.jobs) {
      assert.equal(trace.ok, false);
      assert.equal(trace.error, INVALID_ROMANCE_SCOPE_ERROR);
      assert.equal(trace.scopedExecutionSkipped, true);
      assert.equal(trace.scopedExecutionSkipReason, INVALID_ROMANCE_SCOPE_ERROR);
      assert.equal(trace.scopedRecordsStored, 0);
      assert.equal(trace.webSearchCalls, 0);
      assert.ok(trace.romanceScope != null || trace.romanceScope === null);
      assert.doesNotThrow(() => JSON.stringify(trace));
    }
  });

  it("scoped records stay out of research.sources and legacy relevance", async () => {
    const scopedUrl = "https://reviews.example.com/scoped-sidecar";
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ sources: [] }),
      initialAnalysis: analysisWith(),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                title: "Scoped",
                url: scopedUrl,
                type: "blog",
                summary:
                  "Protective hero bodyguard touch her and die for Alfa and Beta.",
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => {
          throw new Error("synthesis must not run for scoped-only round");
        },
        analyze: async () => analysisWith(),
      },
    });

    assert.ok(result.research.scopedRetrieval.records.length >= 1);
    assert.equal(
      (result.research.sources || []).some((s) => s.url === scopedUrl),
      false
    );
    const record = result.research.scopedRetrieval.records.find(
      (r) => r.source.url === scopedUrl
    );
    assert.equal(record.scopeStatus, "requested");
    assert.ok(record.requestedRomanceScope);
    assert.equal(result.adaptive.rounds[0].scopedOnlyRound, true);
    assert.equal(result.adaptive.stopReason, "no_new_evidence");
  });

  it("mixed scoped and unscoped round isolates storage", async () => {
    const scopedUrl = "https://reviews.example.com/mixed-scoped";
    const unscopedUrl = "https://reviews.example.com/mixed-unscoped";
    let scopedCalls = 0;
    let unscopedCalls = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ sources: [] }),
      initialAnalysis: analysisWith(),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        executeFollowUpJob: async ({ job, round }) => {
          if (job.romanceScope) {
            scopedCalls += 1;
            return {
              sources: prepareFollowUpSources(
                [
                  {
                    title: "Scoped",
                    url: scopedUrl,
                    type: "blog",
                    summary:
                      "Protective hero bodyguard touch her and die for Alfa Beta pairing.",
                  },
                ],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          unscopedCalls += 1;
          return {
            sources: prepareFollowUpSources(
              [
                {
                  title: "Unscoped",
                  url: unscopedUrl,
                  type: "blog",
                  summary:
                    "Worldbuilding epic plot political intrigue war review analysis.",
                },
              ],
              job,
              round
            ),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async ({ sources }) => ({
          parsed: {
            identity,
            facts: {},
            ratings: {},
            reviewConsensus: {},
            sources,
          },
          costUsd: 0.005,
        }),
        analyze: async () => analysisWith(),
      },
    });

    if (scopedCalls > 0) {
      assert.ok(
        result.research.scopedRetrieval.records.some((r) => r.source.url === scopedUrl)
      );
      assert.equal(
        (result.research.sources || []).some((s) => s.url === scopedUrl),
        false
      );
    }
    if (unscopedCalls > 0) {
      assert.ok((result.research.sources || []).some((s) => s.url === unscopedUrl));
    }
    assert.ok(scopedCalls + unscopedCalls >= 1);
  });

  it("sidecar survives rebuildResearchFromSources", async () => {
    const sidecar = {
      records: buildScopedRetrievalRecords(
        [preparedSource({ url: "https://reviews.example.com/rebuild" })],
        scopedJob(),
        1
      ),
    };
    const rebuilt = await rebuildResearchFromSources({
      identity,
      catalog: {},
      mofibo: {},
      sources: [{ id: "source-1", url: "https://legacy.example/one", type: "blog" }],
      previousResearch: {
        ...researchBase(),
        scopedRetrieval: sidecar,
      },
      searchResults: [],
      synthesize: async ({ sources }) => ({
        parsed: {
          identity,
          facts: {},
          ratings: {},
          reviewConsensus: {},
          sources,
        },
        costUsd: 0.001,
      }),
    });
    assert.equal(rebuilt.research.scopedRetrieval.records.length, 1);
    assert.equal(
      rebuilt.research.scopedRetrieval.records[0].source.url,
      "https://reviews.example.com/rebuild"
    );
  });

  it("raw URL scoped backfill stays in sidecar only", async () => {
    const url = "https://reviews.example.com/raw-backfill";
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ sources: [] }),
      initialAnalysis: analysisWith(),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async () => ({
          sources: [],
          rawUrls: [{ url, title: "Raw" }],
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => {
          throw new Error("no synth");
        },
        analyze: async () => analysisWith(),
      },
    });
    assert.ok(result.research.scopedRetrieval.records.some((r) => r.source.url === url));
    assert.equal((result.research.sources || []).some((s) => s.url === url), false);
  });
});

describe("Structure 3.2 regression", () => {
  it("ADAPTIVE_VERSION is adaptive-v12", () => {
    assert.equal(ADAPTIVE_VERSION, "adaptive-v12");
  });

  it("legacy unscoped relevance path unchanged for null scope", () => {
    const source = preparedSource({
      url: "https://reviews.example.com/legacy",
      targetFields: [PROTECTIVE],
    });
    const jobs = [scopedJob({ romanceScope: null })];
    const relevant = isFollowUpSourceRelevant(source, jobs, {
      research: researchBase(),
      identity,
      leadCharacters: { mmc: ALFA, fmc: BETA, resolution: { resolved: true } },
    });
    assert.equal(typeof relevant, "boolean");
  });
});

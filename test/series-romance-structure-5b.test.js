import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  ADAPTIVE_MAX_ADDITIONAL_COST_USD,
  ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS,
  ADAPTIVE_MAX_FOLLOWUP_ROUNDS,
  ADAPTIVE_MAX_JOBS_PER_ROUND,
  ADAPTIVE_VERSION,
  SCOPED_COVERAGE_VERSION,
  SUBJECT_BINDING_VERSION,
} from "../server/services/versions.js";
import {
  analyzeResearchNeeds,
  calculateResearchCoverage,
  calculateScopedGapPriority,
  detectResearchGaps,
  planFollowUpResearch,
} from "../server/services/adaptiveResearch.js";
import {
  prepareFollowUpSources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";
import { PAIRING_RELATIONS } from "../server/services/seriesRomanceIdentity.js";
import {
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  buildRomanceScope,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "../server/services/seriesRomancePlanning.js";
import { buildScopedRetrievalRecord } from "../server/services/seriesRomanceRetrieval.js";
import { bindScopedRetrievalRecord } from "../server/services/seriesRomanceSubjectBinding.js";
import {
  compareScopedRequiredProgress,
  emptyScopedRoundObservability,
} from "../server/services/seriesRomanceScopedCoverage.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const WORLD = "Worldbuilding (0-5)";
const SPICE = "Spice/erotik (0-5)";
const CHAR = "Karakterudvikling (0-5)";

const ALFA = "Alfa";
const BETA = "Beta";
const GAMMA = "Gamma";
const DELTA = "Delta";

const identity = {
  title: "Cycle Alpha",
  author: "A. Author",
  series: "Cycle Alpha",
  firstBook: "Alpha One",
};

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "high",
    basis: "source_consensus",
    evidenceSourceIds: ["ev-1"],
    conflictingSourceIds: [],
    sourceCount: 2,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function weakAssessment(over = {}) {
  return assessment({
    confidence: "low",
    basis: "ai_inference",
    evidenceSourceIds: [],
    sourceCount: 0,
    ...over,
  });
}

function assessmentsAll(factory = assessment) {
  return Object.fromEntries(SUBJECTIVE_KEYS.map((field) => [field, factory()]));
}

function readyDiscovery(romance) {
  return stampTopologyDiscovery(romance, {
    resolved: true,
    attemptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function rotatingIdentity() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        {
          id: "pair-ab",
          members: [member(BETA, "fmc"), member(ALFA, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
          arcScopes: [{ id: "arc-a", label: "Dawn Arc" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          id: "pair-gd",
          members: [member(DELTA, "fmc"), member(GAMMA, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
          arcScopes: [{ id: "arc-b", label: "Dusk Arc" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    })
  );
}

function singleCoupleIdentity() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        {
          members: [member(ALFA, "mmc"), member(BETA, "fmc")],
          bookScopes: [
            { bookNumber: 1, title: "Alpha One" },
            { bookNumber: 2, title: "Alpha Two" },
          ],
          prominence: "primary",
        },
      ],
    })
  );
}

function pairingKey(romance, index) {
  const pairing = romance.pairings[index];
  return semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing.members),
    bookScopes: pairing.bookScopes,
    arcScopes: pairing.arcScopes,
  });
}

function researchBase({ romance = rotatingIdentity(), sources = [], records = [] } = {}) {
  return {
    sources,
    scopedRetrieval: { records },
    seriesRomanceIdentity: romance,
    seriesIdentity: {
      mmc: ALFA,
      fmc: BETA,
      confidence: "high",
      resolution: { resolved: true },
    },
    meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
  };
}

function scopedJob(romance, pairingIndex, fields = [PROTECTIVE]) {
  const pairing = romance.pairings[pairingIndex];
  return {
    id: `followup-protective-r1-${pairingIndex + 1}`,
    strategy: "hero_protective_dynamic",
    fields,
    targetFields: fields,
    batchHint: "helteprofil",
    userPrompt: "Find protective evidence.",
    queryHints: [],
    retrievalMode: "reader_direct",
    romanceScope: buildRomanceScope(pairing, romance.topology),
  };
}

function makeBoundRecord({
  romance,
  pairingIndex = 0,
  summary,
  url,
  fields = [PROTECTIVE],
} = {}) {
  const job = scopedJob(romance, pairingIndex, fields);
  const record = buildScopedRetrievalRecord(
    {
      title: "Review",
      url:
        url ||
        `https://reviews.example.com/${encodeURIComponent(summary.slice(0, 24))}`,
      type: "blog",
      batch: "helteprofil",
      summary,
      focus: "hero_protective_dynamic",
      followUpJobId: job.id,
      retrievalAttempt: 1,
      retrievalStrategy: "primary",
    },
    job,
    1
  );
  return bindScopedRetrievalRecord(record, romance);
}

function coverProtectiveCell(romance, pairingIndex, urls) {
  return urls.map((url, i) =>
    makeBoundRecord({
      romance,
      pairingIndex,
      url,
      summary: `${romance.pairings[pairingIndex].members.find((m) => m.slot === "mmc").name} repeatedly protects ${romance.pairings[pairingIndex].members.find((m) => m.slot === "fmc").name} and acts as bodyguard when danger appears. Direct scene discussion of protective reaction. Example ${i}.`,
      fields: [PROTECTIVE],
    })
  );
}

function coverScopedField(romance, pairingIndex, field, urls) {
  const pairing = romance.pairings[pairingIndex];
  const mmc = pairing.members.find((m) => m.slot === "mmc").name;
  const fmc = pairing.members.find((m) => m.slot === "fmc").name;
  const summaries = {
    [PROTECTIVE]: `${mmc} repeatedly protects ${fmc} and acts as bodyguard when danger appears. Direct scene discussion of protective reaction.`,
    [BODYGUARD]: `${mmc} is her bodyguard and shields ${fmc} in concrete danger scenes described by readers.`,
    [THAD]: `Touch her and die: ${mmc} threatens anyone who touches ${fmc}; readers describe the possessive reaction in scenes.`,
    [RHYSAND]: `${mmc} respects ${fmc}'s agency and treats her as equal partner; Rhysand-faktor power balance described.`,
    [FMC_DEV]: `${fmc} grows across the arc with clear female character development from book one onward.`,
  };
  return urls.map((url, i) =>
    makeBoundRecord({
      romance,
      pairingIndex,
      url,
      fields: [field],
      summary: `${summaries[field]} Example ${i}.`,
    })
  );
}

/** Leave one required cell uncovered so a productive scoped job remains possible. */
function coverAllRequiredExcept(romance, exceptPairingIndex, exceptField) {
  const records = [];
  let n = 0;
  for (let pairingIndex = 0; pairingIndex < romance.pairings.length; pairingIndex++) {
    for (const field of ROMANCE_SCOPE_ELIGIBLE_FIELDS) {
      if (pairingIndex === exceptPairingIndex && field === exceptField) continue;
      n += 1;
      records.push(
        ...coverScopedField(romance, pairingIndex, field, [
          `https://reviews.example.com/precover-${n}-a`,
          `https://reviews.example.com/precover-${n}-b`,
          `https://reviews.example.com/precover-${n}-c`,
        ])
      );
    }
  }
  return records;
}

describe("Structure 5B scoped gaps", () => {
  it("emits one scoped gap per uncovered required cell; covered and observed excluded", () => {
    const romance = rotatingIdentity();
    const records = coverProtectiveCell(romance, 0, [
      "https://reviews.example.com/cov-a1",
      "https://reviews.example.com/cov-a2",
      "https://reviews.example.com/cov-a3",
    ]);
    const research = researchBase({ romance, records });
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(),
      research,
      identity,
    });
    const gaps = detectResearchGaps({
      coverage,
      assessments: assessmentsAll(),
      research,
    });
    const scoped = gaps.filter((g) => g.scoped === true);
    const coveredPairKey = pairingKey(romance, 0);
    assert.equal(
      scoped.some(
        (g) => g.field === PROTECTIVE && g.semanticPairingKey === coveredPairKey
      ),
      false
    );
    const expectedUncovered =
      2 * ROMANCE_SCOPE_ELIGIBLE_FIELDS.length -
      (coverage.scoped.cells.filter((c) => c.requirement === "required" && c.covered)
        .length);
    assert.equal(scoped.length, expectedUncovered);
    assert.ok(scoped.every((g) => g.romanceScope && g.cellKey && g.scoped === true));
    assert.equal(
      scoped.filter((g) => g.relationshipRole === "alternative_love_interest").length,
      0
    );
  });

  it("active mode replaces only eligible legacy gaps", () => {
    const romance = rotatingIdentity();
    const research = researchBase({ romance });
    const assessments = {
      ...assessmentsAll(weakAssessment),
    };
    const coverage = calculateResearchCoverage({ assessments, research, identity });
    const gaps = detectResearchGaps({ coverage, assessments, research });
    for (const field of ROMANCE_SCOPE_ELIGIBLE_FIELDS) {
      const forField = gaps.filter((g) => g.field === field);
      assert.ok(forField.length >= 1);
      assert.ok(forField.every((g) => g.scoped === true));
    }
    const world = gaps.filter((g) => g.field === WORLD);
    assert.ok(world.length >= 1);
    assert.ok(world.every((g) => g.scoped !== true));
  });

  it("direct gap romanceScope with no reselection or null fallback", () => {
    const romance = rotatingIdentity();
    const research = researchBase({ romance });
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(weakAssessment),
      research,
      identity,
    });
    const gaps = detectResearchGaps({
      coverage,
      assessments: assessmentsAll(weakAssessment),
      research,
    }).filter((g) => g.scoped);
    assert.ok(gaps.length > 0);
    for (const gap of gaps) {
      assert.ok(gap.romanceScope);
      assert.equal(semanticPairingKey(gap.romanceScope), gap.semanticPairingKey);
      assert.equal(gap.romanceScope.topology, "rotating_couples");
    }
    const jobs = planFollowUpResearch({
      identity,
      research,
      assessments: assessmentsAll(weakAssessment),
      coverage,
      gaps: detectResearchGaps({
        coverage,
        assessments: assessmentsAll(weakAssessment),
        research,
      }),
      maxJobs: ADAPTIVE_MAX_JOBS_PER_ROUND,
    });
    for (const job of jobs.filter((j) => j.romanceScope)) {
      assert.ok(job.romanceScope.memberNames?.length);
      assert.equal(job.romanceScope.topology, "rotating_couples");
    }
  });

  it("priority uses only tine weight + deficit and is array-order invariant", () => {
    const low = calculateScopedGapPriority({ field: WORLD, coverageScore: 80 });
    const high = calculateScopedGapPriority({ field: PROTECTIVE, coverageScore: 0 });
    assert.ok(high.priority > low.priority);
    assert.equal(high.priorityFactors.inferenceBoost, undefined);
    assert.equal(high.priorityFactors.conflictBoost, undefined);

    const romance = rotatingIdentity();
    const research = researchBase({ romance });
    const assessments = assessmentsAll(weakAssessment);
    const coverage = calculateResearchCoverage({ assessments, research, identity });
    const a = detectResearchGaps({ coverage, assessments, research }).filter(
      (g) => g.scoped
    );
    const flippedCells = [...coverage.scoped.cells].reverse();
    const coverageFlipped = {
      ...coverage,
      scoped: { ...coverage.scoped, cells: flippedCells },
    };
    const b = detectResearchGaps({
      coverage: coverageFlipped,
      assessments,
      research,
    }).filter((g) => g.scoped);
    assert.deepEqual(
      a.map((g) => `${g.field}|${g.semanticPairingKey}|${g.priority}`),
      b.map((g) => `${g.field}|${g.semanticPairingKey}|${g.priority}`)
    );
  });
});

describe("Structure 5B planner", () => {
  it("never groups different pairings into one job", () => {
    const romance = rotatingIdentity();
    const research = researchBase({ romance });
    const assessments = assessmentsAll(weakAssessment);
    const jobs = planFollowUpResearch({
      identity,
      research,
      assessments,
      maxJobs: 6,
    });
    const scopedJobs = jobs.filter((j) => j.romanceScope);
    assert.ok(scopedJobs.length >= 2);
    const keys = scopedJobs.map((j) => semanticPairingKey(j.romanceScope));
    assert.equal(new Set(keys).size, keys.length);
    for (const job of scopedJobs) {
      assert.ok(job.fields.every((f) => ROMANCE_SCOPE_ELIGIBLE_FIELDS.includes(f)));
    }
  });

  it("same-round allows at most one job per semantic pairing", () => {
    const romance = rotatingIdentity();
    const jobs = planFollowUpResearch({
      identity,
      research: researchBase({ romance }),
      assessments: assessmentsAll(weakAssessment),
      maxJobs: 6,
    });
    const keys = jobs
      .filter((j) => j.romanceScope)
      .map((j) => semanticPairingKey(j.romanceScope));
    assert.equal(keys.length, new Set(keys).size);
  });

  it("cross-round success/failure/overlap/different strategy/planned-not-executed", () => {
    const romance = rotatingIdentity();
    const scopeA = buildRomanceScope(romance.pairings[0], romance.topology);
    const scopeB = buildRomanceScope(romance.pairings[1], romance.topology);
    const research = researchBase({ romance });
    const assessments = assessmentsAll(weakAssessment);

    const afterSuccess = planFollowUpResearch({
      identity,
      research,
      assessments,
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE, BODYGUARD, THAD],
              romanceScope: scopeA,
              ok: true,
            },
          ],
        },
      ],
      maxJobs: 6,
    });
    assert.equal(
      afterSuccess.some(
        (j) =>
          j.strategy === "hero_protective_dynamic" &&
          j.romanceScope &&
          semanticPairingKey(j.romanceScope) === semanticPairingKey(scopeA)
      ),
      false
    );

    const afterFailure = planFollowUpResearch({
      identity,
      research,
      assessments,
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: scopeB,
              ok: false,
              error: "boom",
            },
          ],
        },
      ],
      maxJobs: 6,
    });
    assert.equal(
      afterFailure.some(
        (j) =>
          j.strategy === "hero_protective_dynamic" &&
          j.romanceScope &&
          semanticPairingKey(j.romanceScope) === semanticPairingKey(scopeB) &&
          (j.targetFields || []).includes(PROTECTIVE)
      ),
      false
    );

    const otherStrategy = planFollowUpResearch({
      identity,
      research,
      assessments,
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE, BODYGUARD, THAD],
              romanceScope: scopeA,
              ok: true,
            },
          ],
        },
      ],
      maxJobs: 6,
    });
    assert.ok(
      otherStrategy.some(
        (j) =>
          j.romanceScope &&
          j.strategy !== "hero_protective_dynamic" &&
          semanticPairingKey(j.romanceScope) === semanticPairingKey(scopeA)
      ),
      "a different strategy may still target the same pairing"
    );

    // Planned but unexecuted jobs are absent from previousRounds traces.
    const fresh = planFollowUpResearch({
      identity,
      research,
      assessments,
      previousRounds: [],
      maxJobs: 6,
    });
    assert.ok(
      fresh.some(
        (j) =>
          j.strategy === "hero_protective_dynamic" &&
          j.romanceScope &&
          semanticPairingKey(j.romanceScope) === semanticPairingKey(scopeA)
      )
    );
  });

  it("exhausted scoped gaps produce no unscoped replacement for that strategy", () => {
    const romance = rotatingIdentity();
    const previousRounds = [
      {
        jobs: romance.pairings.map((pairing) => ({
          strategy: "hero_protective_dynamic",
          targetFields: [PROTECTIVE, BODYGUARD, THAD],
          romanceScope: buildRomanceScope(pairing, romance.topology),
          ok: true,
        })),
      },
    ];
    const jobs = planFollowUpResearch({
      identity,
      research: researchBase({ romance }),
      assessments: assessmentsAll(weakAssessment),
      previousRounds,
      maxJobs: 6,
    });
    assert.equal(
      jobs.some((j) => j.strategy === "hero_protective_dynamic"),
      false
    );
  });

  it("retained non-eligible legacy gaps still plan", () => {
    const romance = rotatingIdentity();
    const jobs = planFollowUpResearch({
      identity,
      research: researchBase({ romance }),
      assessments: assessmentsAll(weakAssessment),
      maxJobs: 6,
    });
    assert.ok(jobs.some((j) => (j.targetFields || []).includes(WORLD) || (j.targetFields || []).includes(SPICE) || j.strategy === "romance_spice" || j.strategy === "plot_worldbuilding"));
  });

  it("jobs per round cap unchanged", () => {
    const romance = rotatingIdentity();
    const jobs = planFollowUpResearch({
      identity,
      research: researchBase({ romance }),
      assessments: assessmentsAll(weakAssessment),
      maxJobs: ADAPTIVE_MAX_JOBS_PER_ROUND,
    });
    assert.ok(jobs.length <= ADAPTIVE_MAX_JOBS_PER_ROUND);
    assert.equal(ADAPTIVE_MAX_JOBS_PER_ROUND, 3);
  });
});

describe("Structure 5B completion and legacy parity", () => {
  it("high legacy coverage cannot target_reached while required scoped cells uncovered", async () => {
    const romance = rotatingIdentity();
    const assessments = assessmentsAll();
    const research = researchBase({ romance, sources: [] });
    // Force high weighted coverage via assessments, but leave scoped cells empty.
    const intel = analyzeResearchNeeds({
      identity,
      research,
      assessments,
    });
    assert.equal(intel.coverage.scoped.active, true);
    assert.equal(intel.coverage.scoped.summary.allRequiredCellsCovered, false);
    assert.ok((intel.followUpPlan || []).length > 0);

    const result = await runAdaptiveResearch({
      identity,
      initialResearch: research,
      initialAnalysis: { row: {}, meta: { assessments, estimatedCostUsd: 0 } },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 0,
        followUpPlan: [],
        enabled: true,
      },
    });
    // With empty plan and uncovered scoped cells, stopFromIntelligence → no_gaps not target_reached
    // maxFollowUpRounds 0 may not enter loop; early stop uses followUpPlan from analyze.
    assert.notEqual(result.adaptive.stopReason, "target_reached");
  });

  it("completion requires all required cells, not average", () => {
    const romance = rotatingIdentity();
    const records = coverProtectiveCell(romance, 0, [
      "https://reviews.example.com/avg-a1",
      "https://reviews.example.com/avg-a2",
      "https://reviews.example.com/avg-a3",
    ]);
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(),
      research: researchBase({ romance, records }),
      identity,
    });
    assert.ok(coverage.scoped.summary.requiredCoverageAverage > 0);
    assert.equal(coverage.scoped.summary.allRequiredCellsCovered, false);
  });

  it("single_couple and not-ready remain deep-equal legacy behavior", () => {
    const assessments = assessmentsAll(weakAssessment);
    const single = calculateResearchCoverage({
      assessments,
      research: researchBase({ romance: singleCoupleIdentity() }),
      identity,
    });
    const notReady = calculateResearchCoverage({
      assessments,
      research: researchBase({
        romance: {
          topology: "unknown",
          pairings: [],
          resolution: { resolved: false },
        },
      }),
      identity,
    });
    assert.equal(single.scoped, undefined);
    assert.equal(notReady.scoped, undefined);

    const singleJobs = planFollowUpResearch({
      identity,
      research: researchBase({ romance: singleCoupleIdentity() }),
      assessments,
    });
    const notReadyJobs = planFollowUpResearch({
      identity,
      research: researchBase({
        romance: {
          topology: "unknown",
          pairings: [],
          resolution: { resolved: false },
        },
      }),
      assessments,
    });
    assert.ok(singleJobs.every((j) => j.romanceScope == null));
    assert.ok(notReadyJobs.every((j) => j.romanceScope == null));
  });

  it("version assertions use adaptive-v15 and scoped-coverage-v1", () => {
    assert.equal(ADAPTIVE_VERSION, "adaptive-v15");
    assert.equal(SCOPED_COVERAGE_VERSION, "scoped-coverage-v1");
    assert.equal(SUBJECT_BINDING_VERSION, "subject-binding-v1");
    assert.equal(ADAPTIVE_MAX_FOLLOWUP_ROUNDS, 2);
    assert.equal(ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS, 6);
    assert.equal(ADAPTIVE_MAX_ADDITIONAL_COST_USD, 0.25);
    const empty = emptyScopedRoundObservability();
    assert.equal(empty.scopedProductive, false);
    assert.equal(empty.scopedOnlyRound, false);
  });
});

describe("Structure 5B scoped-only loop", () => {
  it("productive scoped-only round continues without synthesis/analyze", async () => {
    const romance = rotatingIdentity();
    let synthesizeCalls = 0;
    let analyzeCalls = 0;
    let urlCounter = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 6,
        followUpPlan: [
          {
            ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
            id: "followup-prod-r1-1",
            priority: 1,
            reasons: ["low_coverage"],
            leadCharacters: {},
            series: { title: identity.series },
            retrievalApproaches: [],
            queryHints: [],
            userPrompt: "prod",
            targetPhenomena: [],
            previousStrategyUsed: false,
            retrievalMode: "reader_direct",
            preferredSourceRoles: [],
            fieldNeeds: [],
          },
        ],
        executeFollowUpJob: async ({ job, round }) => {
          urlCounter += 1;
          const names = job.romanceScope?.memberNames || [];
          const mmc = names.find((n) => [ALFA, GAMMA].includes(n)) || ALFA;
          const fmc = names.find((n) => [BETA, DELTA].includes(n)) || BETA;
          return {
            sources: prepareFollowUpSources(
              [
                {
                  title: `Scoped ${urlCounter}`,
                  url: `https://reviews.example.com/prod-${urlCounter}`,
                  type: "blog",
                  summary: `${mmc} repeatedly protects ${fmc} in concrete danger scenes and acts as her bodyguard. Touch her and die reaction is described in detail by readers.`,
                },
              ],
              job,
              round
            ),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          synthesizeCalls += 1;
          throw new Error("synthesis must not run for scoped-only");
        },
        analyze: async () => {
          analyzeCalls += 1;
          throw new Error("analyze must not run for scoped-only");
        },
      },
    });

    assert.equal(synthesizeCalls, 0);
    assert.equal(analyzeCalls, 0);
    assert.equal(result.adaptive.rounds.length, 1);
    const round = result.adaptive.rounds[0];
    assert.equal(round.scopedOnlyRound, true);
    assert.equal(round.scopedProductive, true);
    assert.ok(round.scopedRequiredIdentitiesAdded > 0);
    assert.equal(round.newSources, 0);
    // Continued past no_new_evidence; stops on max_rounds after productive scoped-only.
    assert.equal(result.adaptive.stopReason, "max_rounds");
  });

  it("duplicate/ineligible/observed-only scoped records stop as no_new_evidence", async () => {
    const romance = rotatingIdentity();
    const existing = makeBoundRecord({
      romance,
      pairingIndex: 0,
      url: "https://reviews.example.com/dup-once",
      summary: `${ALFA} protects ${BETA} in a concrete scene.`,
    });
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({
        romance,
        sources: [],
        records: [existing],
      }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        followUpPlan: [
          {
            ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
            id: "followup-dup-r1-1",
            priority: 1,
            reasons: ["low_coverage"],
            leadCharacters: {},
            series: { title: identity.series },
            retrievalApproaches: [],
            queryHints: [],
            userPrompt: "dup",
            targetPhenomena: [],
            previousStrategyUsed: false,
            retrievalMode: "reader_direct",
            preferredSourceRoles: [],
            fieldNeeds: [],
          },
        ],
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                title: "Dup",
                url: "https://reviews.example.com/dup-once",
                type: "blog",
                summary: `${ALFA} protects ${BETA} in a concrete scene.`,
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => {
          throw new Error("synthesis must not run");
        },
        analyze: async () => {
          throw new Error("analyze must not run");
        },
      },
    });

    assert.equal(result.adaptive.rounds[0].scopedOnlyRound, true);
    assert.equal(result.adaptive.rounds[0].scopedProductive, false);
    assert.equal(result.adaptive.stopReason, "no_new_evidence");
  });

  it("mixed legacy+scoped round preserves legacy pipeline", async () => {
    const romance = rotatingIdentity();
    let synthesizeCalls = 0;
    let analyzeCalls = 0;
    const scoped = {
      ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
      id: "followup-mixed-scoped-r1-1",
      priority: 1,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "scoped",
      targetPhenomena: [],
      previousStrategyUsed: false,
      retrievalMode: "reader_direct",
      preferredSourceRoles: [],
      fieldNeeds: [],
    };
    const legacy = {
      id: "followup-plot_worldbuilding-r1-2",
      strategy: "plot_worldbuilding",
      round: 1,
      fields: [WORLD],
      targetFields: [WORLD],
      batchHint: "plotkarakter",
      priority: 0.5,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "legacy worldbuilding",
      targetPhenomena: ["worldbuilding"],
      previousStrategyUsed: false,
      retrievalMode: "general",
      preferredSourceRoles: [],
      fieldNeeds: [],
      romanceScope: null,
    };
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 6,
        followUpPlan: [scoped, legacy],
        executeFollowUpJob: async ({ job, round }) => {
          if (job.romanceScope) {
            return {
              sources: prepareFollowUpSources(
                [
                  {
                    title: "Scoped",
                    url: "https://reviews.example.com/mixed-scoped-5b",
                    type: "blog",
                    summary: `${ALFA} repeatedly protects ${BETA} and acts as bodyguard in danger scenes.`,
                  },
                ],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          return {
            sources: prepareFollowUpSources(
              [
                {
                  title: "Legacy",
                  url: "https://reviews.example.com/mixed-legacy-5b",
                  type: "blog",
                  summary:
                    "Worldbuilding is rich with magic systems, cultures, and detailed setting across the series.",
                },
              ],
              job,
              round
            ),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async ({ sources }) => {
          synthesizeCalls += 1;
          return {
            research: {
              ...researchBase({ romance, sources }),
              sources,
            },
            costUsd: 0.01,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
        analyze: async () => {
          analyzeCalls += 1;
          return {
            row: {},
            meta: {
              assessments: assessmentsAll(weakAssessment),
              estimatedCostUsd: 0.01,
            },
          };
        },
      },
    });

    assert.ok(synthesizeCalls >= 1);
    assert.ok(analyzeCalls >= 1);
    assert.equal(result.adaptive.rounds[0].scopedOnlyRound, false);
    assert.ok(
      (result.research.sources || []).some(
        (s) => s.url === "https://reviews.example.com/mixed-legacy-5b"
      )
    );
  });

  it("mixed scoped gain + irrelevant legacy continues without synthesize", async () => {
    const romance = rotatingIdentity();
    let synthesizeCalls = 0;
    let analyzeCalls = 0;
    const irrelevantUrl = "https://reviews.example.com/mixed-irrelevant-legacy";
    const scoped = {
      ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
      id: "followup-mixed-irr-scoped-r1-1",
      priority: 1,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "scoped",
      targetPhenomena: [],
      previousStrategyUsed: false,
      retrievalMode: "reader_direct",
      preferredSourceRoles: [],
      fieldNeeds: [],
    };
    const legacy = {
      id: "followup-plot_worldbuilding-r1-2",
      strategy: "plot_worldbuilding",
      round: 1,
      fields: [WORLD],
      targetFields: [WORLD],
      batchHint: "plotkarakter",
      priority: 0.5,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "legacy worldbuilding",
      targetPhenomena: ["worldbuilding"],
      previousStrategyUsed: false,
      retrievalMode: "general",
      preferredSourceRoles: [],
      fieldNeeds: [],
      romanceScope: null,
    };
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 6,
        followUpPlan: [scoped, legacy],
        executeFollowUpJob: async ({ job, round }) => {
          if (job.romanceScope) {
            return {
              sources: prepareFollowUpSources(
                [
                  {
                    title: "Scoped productive",
                    url: "https://reviews.example.com/mixed-scoped-irr-5b",
                    type: "blog",
                    summary: `${ALFA} repeatedly protects ${BETA} and acts as bodyguard in danger scenes. Touch her and die reaction is described.`,
                  },
                ],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          return {
            sources: prepareFollowUpSources(
              [
                {
                  title: "Irrelevant legacy",
                  url: irrelevantUrl,
                  type: "blog",
                  summary:
                    "Bookstore cafe menu includes seasonal pastries, oat milk lattes, and weekend opening hours only.",
                },
              ],
              job,
              round
            ),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          synthesizeCalls += 1;
          throw new Error("synthesis must not run for irrelevant legacy only");
        },
        analyze: async () => {
          analyzeCalls += 1;
          throw new Error("analyze must not run for irrelevant legacy only");
        },
      },
    });

    assert.equal(synthesizeCalls, 0);
    assert.equal(analyzeCalls, 0);
    const round = result.adaptive.rounds[0];
    assert.equal(round.scopedOnlyRound, false);
    assert.equal(round.scopedProductive, true);
    assert.ok(round.scopedRequiredIdentitiesAdded > 0);
    assert.ok(round.newSources > 0);
    assert.equal(round.newRelevantSources, 0);
    assert.notEqual(result.adaptive.stopReason, "no_new_evidence");
    assert.ok(
      (result.research.sources || []).some((s) => s.url === irrelevantUrl)
    );
  });

  it("mixed retained irrelevant legacy shapes round-2 plan from post-merge research", async () => {
    const romance = rotatingIdentity();
    const retainedUrl = "https://reviews.example.com/retained-char-for-other-field";
    let synthesizeCalls = 0;
    let analyzeCalls = 0;
    const scoped = {
      ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
      id: "followup-retained-scoped-r1-1",
      priority: 1,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "scoped",
      targetPhenomena: [],
      previousStrategyUsed: false,
      retrievalMode: "reader_direct",
      preferredSourceRoles: [],
      fieldNeeds: [],
    };
    const legacy = {
      id: "followup-plot_worldbuilding-r1-2",
      strategy: "plot_worldbuilding",
      round: 1,
      fields: [WORLD],
      targetFields: [WORLD],
      batchHint: "plotkarakter",
      priority: 0.5,
      reasons: ["low_coverage"],
      leadCharacters: {},
      series: { title: identity.series },
      retrievalApproaches: [],
      queryHints: [],
      userPrompt: "legacy worldbuilding",
      targetPhenomena: ["worldbuilding"],
      previousStrategyUsed: false,
      retrievalMode: "general",
      preferredSourceRoles: [],
      fieldNeeds: [],
      romanceScope: null,
    };
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({
        romance,
        sources: [],
        records: coverAllRequiredExcept(romance, 0, PROTECTIVE),
      }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 2,
        maxAdditionalWebSearchCalls: 8,
        maxAdditionalCostUsd: 1,
        followUpPlan: [scoped, legacy],
        executeFollowUpJob: async ({ job, round }) => {
          if (round === 1 && job.romanceScope) {
            return {
              sources: prepareFollowUpSources(
                [
                  {
                    title: "Scoped productive",
                    url: "https://reviews.example.com/retained-mixed-scoped-5b",
                    type: "blog",
                    summary: `${ALFA} repeatedly protects ${BETA} and acts as bodyguard in danger scenes. Touch her and die reaction is described.`,
                  },
                ],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          if (round === 1 && !job.romanceScope) {
            return {
              sources: prepareFollowUpSources(
                [
                  {
                    title: "Series arc review",
                    url: retainedUrl,
                    type: "blog",
                    summary:
                      "Strong character development across the series; the protagonists show clear character growth and arc maturation from book one to the finale.",
                  },
                ],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          // Round 2: no new evidence; plan shape is what we assert.
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => {
          synthesizeCalls += 1;
          throw new Error("synthesis must not run without relevant legacy evidence");
        },
        analyze: async () => {
          analyzeCalls += 1;
          throw new Error("analyze must not run without relevant legacy evidence");
        },
      },
    });

    assert.equal(synthesizeCalls, 0);
    assert.equal(analyzeCalls, 0);
    assert.ok(result.adaptive.rounds.length >= 2);
    const round1 = result.adaptive.rounds[0];
    assert.equal(round1.scopedOnlyRound, false);
    assert.equal(round1.scopedProductive, true);
    assert.equal(round1.newRelevantSources, 0);
    assert.ok(round1.newSources > 0);
    assert.ok(
      (result.research.sources || []).some((s) => s.url === retainedUrl)
    );

    const round2Fields = [
      ...new Set(
        (result.adaptive.rounds[1].targetFields || []).concat(
          (result.adaptive.rounds[1].jobs || []).flatMap(
            (j) => j.targetFields || j.fields || []
          )
        )
      ),
    ];
    assert.equal(
      round2Fields.includes(CHAR),
      false,
      `round-2 plan must not re-target ${CHAR} already evidenced by retained source; got ${round2Fields.join(", ")}`
    );

    const stalePlan = planFollowUpResearch({
      identity,
      research: { ...result.research, sources: [] },
      assessments: assessmentsAll(weakAssessment),
      round: 2,
      previousRounds: [round1],
    });
    assert.ok(
      stalePlan.some((j) => (j.targetFields || j.fields || []).includes(CHAR)),
      "pre-merge research would still schedule a Karakterudvikling legacy job"
    );

    // Round 1 continued; final stop must not be no_new_evidence from that round.
    assert.ok(result.adaptive.rounds.length >= 2);
    assert.ok(result.adaptive.plannerCalls <= 4);
    assert.ok(result.adaptive.additionalWebSearchCalls <= 8);
    assert.ok(result.adaptive.additionalCostUsd <= 1);
  });

  it("compareScopedRequiredProgress is order-invariant", () => {
    const before = {
      active: true,
      cells: [
        {
          key: "cell-a",
          requirement: "required",
          coverageScore: 10,
          sourceIdentityKeys: ["b", "a"],
          covered: false,
        },
      ],
      summary: { requiredCoverageAverage: 10, coveredCellCount: 0 },
    };
    const after = {
      active: true,
      cells: [
        {
          key: "cell-a",
          requirement: "required",
          coverageScore: 20,
          sourceIdentityKeys: ["a", "b", "c"],
          covered: false,
        },
        {
          key: "cell-obs",
          requirement: "observed",
          coverageScore: 99,
          sourceIdentityKeys: ["obs"],
          covered: false,
        },
      ],
      summary: { requiredCoverageAverage: 20, coveredCellCount: 0 },
    };
    const flippedAfter = {
      ...after,
      cells: [...after.cells].reverse(),
    };
    assert.deepEqual(
      compareScopedRequiredProgress(before, after),
      compareScopedRequiredProgress(before, flippedAfter)
    );
    const progress = compareScopedRequiredProgress(before, after);
    assert.equal(progress.scopedRequiredIdentitiesAdded, 1);
    assert.equal(progress.scopedRequiredCoverageGain, 10);
    assert.equal(progress.scopedProductive, true);
  });

  it("same source identity newly contributing to another required cell is productive", () => {
    const shared = "https://reviews.example.com/shared-source";
    const before = {
      active: true,
      cells: [
        {
          key: "cell-a",
          requirement: "required",
          coverageScore: 20,
          sourceIdentityKeys: [shared],
          covered: false,
        },
        {
          key: "cell-b",
          requirement: "required",
          coverageScore: 0,
          sourceIdentityKeys: [],
          covered: false,
        },
      ],
      summary: { requiredCoverageAverage: 10, coveredCellCount: 0 },
    };
    const after = {
      active: true,
      cells: [
        {
          key: "cell-a",
          requirement: "required",
          coverageScore: 20,
          sourceIdentityKeys: [shared],
          covered: false,
        },
        {
          key: "cell-b",
          requirement: "required",
          coverageScore: 20,
          sourceIdentityKeys: [shared],
          covered: false,
        },
      ],
      summary: { requiredCoverageAverage: 20, coveredCellCount: 0 },
    };
    const flippedAfter = {
      ...after,
      cells: [...after.cells].reverse(),
    };
    const progress = compareScopedRequiredProgress(before, after);
    const flipped = compareScopedRequiredProgress(before, flippedAfter);
    assert.deepEqual(progress, flipped);
    assert.equal(progress.scopedRequiredIdentitiesBefore, 1);
    assert.equal(progress.scopedRequiredIdentitiesAfter, 2);
    assert.equal(progress.scopedRequiredIdentitiesAdded, 1);
    assert.equal(progress.scopedProductive, true);
  });

  it("scoped-path honors max rounds, search calls, and cost budgets", async () => {
    const romance = rotatingIdentity();
    const makeScopedPlan = (id) => [
      {
        ...scopedJob(romance, 0, [PROTECTIVE, BODYGUARD, THAD]),
        id,
        priority: 1,
        reasons: ["low_coverage"],
        leadCharacters: {},
        series: { title: identity.series },
        retrievalApproaches: [],
        queryHints: [],
        userPrompt: "budget",
        targetPhenomena: [],
        previousStrategyUsed: false,
        retrievalMode: "reader_direct",
        preferredSourceRoles: [],
        fieldNeeds: [],
      },
    ];
    const execute = async ({ job, round }) => ({
      sources: prepareFollowUpSources(
        [
          {
            title: `Scoped ${round}`,
            url: `https://reviews.example.com/budget-${job.id}-${round}`,
            type: "blog",
            summary: `${ALFA} repeatedly protects ${BETA} and acts as bodyguard in danger scenes.`,
          },
        ],
        job,
        round
      ),
      webSearchCalls: 1,
      costUsd: 0.01,
    });
    const noSynth = {
      synthesize: async () => {
        throw new Error("synthesis must not run");
      },
      analyze: async () => {
        throw new Error("analyze must not run");
      },
    };

    const maxRoundsResult = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 6,
        followUpPlan: makeScopedPlan("followup-budget-rounds-r1-1"),
        executeFollowUpJob: execute,
        ...noSynth,
      },
    });
    assert.equal(maxRoundsResult.adaptive.stopReason, "max_rounds");
    assert.equal(maxRoundsResult.adaptive.rounds[0].scopedOnlyRound, true);
    assert.equal(maxRoundsResult.adaptive.rounds[0].scopedProductive, true);

    const searchBudgetResult = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 2,
        maxAdditionalWebSearchCalls: 1,
        followUpPlan: makeScopedPlan("followup-budget-search-r1-1"),
        executeFollowUpJob: execute,
        ...noSynth,
      },
    });
    assert.equal(searchBudgetResult.adaptive.stopReason, "search_budget_reached");
    assert.equal(searchBudgetResult.adaptive.additionalWebSearchCalls, 1);

    const costBudgetResult = await runAdaptiveResearch({
      identity,
      initialResearch: researchBase({ romance, sources: [] }),
      initialAnalysis: {
        row: {},
        meta: { assessments: assessmentsAll(weakAssessment), estimatedCostUsd: 0 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 2,
        maxAdditionalWebSearchCalls: 6,
        maxAdditionalCostUsd: 0.01,
        followUpPlan: makeScopedPlan("followup-budget-cost-r1-1"),
        executeFollowUpJob: execute,
        ...noSynth,
      },
    });
    assert.equal(costBudgetResult.adaptive.stopReason, "cost_budget_reached");
    assert.ok(costBudgetResult.adaptive.additionalCostUsd >= 0.01);

    assert.equal(ADAPTIVE_MAX_JOBS_PER_ROUND, 3);
    assert.equal(ADAPTIVE_MAX_FOLLOWUP_ROUNDS, 2);
    assert.equal(ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS, 6);
    assert.equal(ADAPTIVE_MAX_ADDITIONAL_COST_USD, 0.25);
  });
});

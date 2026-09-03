import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import { planFollowUpResearch } from "../server/services/adaptiveResearch.js";
import {
  prepareFollowUpSources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";
import {
  ADAPTIVE_MAX_JOBS_PER_ROUND,
  ADAPTIVE_VERSION,
  IDENTITY_RESOLUTION_VERSION,
} from "../server/services/versions.js";
import {
  PAIRING_RELATIONS,
  ROMANCE_DISCOVERY_SOURCES,
  emptyRomanceDiscovery,
  normalizeRomancePairing,
  primaryPairings,
} from "../server/services/seriesRomanceIdentity.js";
import {
  pairingHasScope,
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  buildRomanceScope,
  collectAttemptedSemanticKeys,
  comparePairingSelection,
  defensiveCopyRomanceScope,
  fieldScopeAttemptKey,
  isRomanceScopePlanningReady,
  isTargetFieldsRomanceScopeEligible,
  pairingSelectionSortKey,
  scopeAttemptKey,
  selectRomanceScopeForJob,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "../server/services/seriesRomancePlanning.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const CHAR_DEV = "Karakterudvikling (0-5)";
const SPICE = "Spice/erotik (0-5)";
const WORLD = "Worldbuilding (0-5)";

const LINA = "Lina";
const CORIN = "Corin";
const TESS = "Tess";
const ARDEN = "Arden";
const ZARA = "Zara";
const MILO = "Milo";
const NORA = "Nora";
const ELIN = "Elin";

const identity = {
  title: "The Glass Cycle",
  author: "A. Writer",
  series: "The Glass Cycle",
  firstBook: "Glass One",
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

function assessmentsFor(fields) {
  const list = Array.isArray(fields) ? fields : Object.keys(fields);
  const values = Array.isArray(fields)
    ? Object.fromEntries(list.map((field) => [field, assessment()]))
    : fields;
  return values;
}

function researchWith(over = {}) {
  const resolvedSources = SUBJECTIVE_KEYS.map((field, index) => ({
    id: `resolved-${index}`,
    url: `https://reviews.example.com/${index}`,
    type: "blog",
    summary: `${field} is supported by direct detailed reader discussion and examples.`,
  }));
  return {
    identity: { title: identity.title, author: identity.author },
    sources: over.sources || resolvedSources,
    reviewConsensus: {},
    facts: {},
    ratings: {},
    meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
    seriesIdentity: {
      mmc: CORIN,
      fmc: LINA,
      confidence: "high",
      resolution: { resolved: true },
    },
    seriesRomanceIdentity: over.seriesRomanceIdentity,
    ...over,
  };
}

function resolvedAssessment(field) {
  const sourceId = `resolved-${SUBJECTIVE_KEYS.indexOf(field)}`;
  return assessment({
    confidence: "high",
    basis: "source_consensus",
    evidenceSourceIds: [sourceId],
    score: 4,
  });
}

function readyDiscovery(romance) {
  return stampTopologyDiscovery(romance, {
    resolved: true,
    attemptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function rotatingPairings(over = {}) {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: over.pairings || [
        {
          members: [member(LINA, "fmc"), member(CORIN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [member(TESS, "fmc"), member(ARDEN, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Glass Two" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    })
  );
}

function threePairingRotatingPermuted(order = 0) {
  const pairings = [
    {
      id: "model-should-not-win",
      members: [member(ZARA, "fmc"), member(MILO, "mmc")],
      bookScopes: [{ bookNumber: 3, title: "Glass Three" }],
      prominence: "primary",
      relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
    },
    {
      members: [member(LINA, "fmc"), member(CORIN, "mmc")],
      bookScopes: [{ bookNumber: 1, title: "Glass One" }],
      prominence: "primary",
      relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
    },
    {
      members: [member(TESS, "fmc"), member(ARDEN, "mmc")],
      bookScopes: [{ bookNumber: 2, title: "Glass Two" }],
      prominence: "primary",
      relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
    },
  ];
  const permutations = [
    pairings,
    [pairings[2], pairings[0], pairings[1]],
    [pairings[1], pairings[2], pairings[0]],
  ];
  return rotatingPairings({ pairings: permutations[order] });
}

function ensembleReady() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "ensemble_mixed",
      pairings: [
        {
          members: [member(LINA, "fmc"), member(CORIN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          prominence: "primary",
        },
        {
          members: [member(NORA, "fmc"), member(ELIN, "mmc")],
          arcScopes: [{ id: "arc-a", label: "First arc" }],
          prominence: "primary",
        },
      ],
    })
  );
}

function planJobs({
  fields,
  romance,
  previousRounds = [],
  maxJobs = ADAPTIVE_MAX_JOBS_PER_ROUND,
} = {}) {
  const targetFields = Array.isArray(fields) ? fields : [fields];
  const assessments = Object.fromEntries(
    SUBJECTIVE_KEYS.map((field) => [
      field,
      targetFields.includes(field)
        ? assessment({ basis: "ai_inference", evidenceSourceIds: [] })
        : resolvedAssessment(field),
    ])
  );
  return planFollowUpResearch({
    identity,
    research: researchWith({ seriesRomanceIdentity: romance }),
    assessments,
    previousRounds,
    maxJobs,
  });
}

describe("seriesRomancePlanning eligibility", () => {
  it("markerer alle fem allowlist-fields som eligible", () => {
    for (const field of ROMANCE_SCOPE_ELIGIBLE_FIELDS) {
      assert.equal(isTargetFieldsRomanceScopeEligible([field]), true);
    }
  });

  it("markerer alle andre canonical subjective fields som ineligible", () => {
    for (const field of SUBJECTIVE_KEYS) {
      if (ROMANCE_SCOPE_ELIGIBLE_FIELDS.includes(field)) continue;
      assert.equal(isTargetFieldsRomanceScopeEligible([field]), false);
    }
  });

  it("mixed eligible/ineligible job → romanceScope null", () => {
    assert.equal(
      selectRomanceScopeForJob({
        seriesRomanceIdentity: rotatingPairings(),
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE, WORLD],
      }),
      null
    );
    const protectiveJob = planJobs({
      fields: [PROTECTIVE],
      romance: rotatingPairings(),
    })[0];
    assert.ok(protectiveJob.romanceScope);
  });

  it("missing/empty target fields → romanceScope null", () => {
    assert.equal(isTargetFieldsRomanceScopeEligible([]), false);
    assert.equal(isTargetFieldsRomanceScopeEligible(null), false);
  });

  it("splitter ikke jobs og ændrer ikke job-count", () => {
    const baselineCount = planJobs({
      fields: [PROTECTIVE, BODYGUARD, THAD],
      romance: null,
    }).length;
    const scopedCount = planJobs({
      fields: [PROTECTIVE, BODYGUARD, THAD],
      romance: rotatingPairings(),
    }).length;
    assert.equal(scopedCount, baselineCount);
  });
});

describe("seriesRomancePlanning readiness", () => {
  it("resolved rotating topology discovery → ready", () => {
    assert.equal(isRomanceScopePlanningReady(rotatingPairings()), true);
  });

  it("resolved ensemble topology discovery → ready", () => {
    assert.equal(isRomanceScopePlanningReady(ensembleReady()), true);
  });

  it("legacy fallbacks returnerer false", () => {
    assert.equal(isRomanceScopePlanningReady(null), false);
    assert.equal(
      isRomanceScopePlanningReady({
        topology: "rotating_couples",
        pairings: rotatingPairings().pairings,
        discovery: emptyRomanceDiscovery({
          source: ROMANCE_DISCOVERY_SOURCES.LEGACY_PROJECTION,
        }),
        resolution: { resolved: true },
      }),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady({
        ...rotatingPairings(),
        discovery: {
          ...rotatingPairings().discovery,
          resolved: false,
        },
      }),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady({
        ...rotatingPairings(),
        resolution: { resolved: false },
      }),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady({
        ...rotatingPairings(),
        discovery: {
          ...rotatingPairings().discovery,
          version: "identity-v1",
        },
      }),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady({
        ...rotatingPairings(),
        topology: "unknown",
      }),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady(
        readyDiscovery(
          validateRomanceTopology({
            topology: "single_couple",
            pairings: [
              {
                members: [member(LINA, "fmc"), member(CORIN, "mmc")],
                bookScopes: [
                  { bookNumber: 1, title: "Glass One" },
                  { bookNumber: 2, title: "Glass Two" },
                ],
                prominence: "primary",
              },
            ],
          })
        )
      ),
      false
    );
    assert.equal(
      isRomanceScopePlanningReady({
        ...rotatingPairings(),
        pairings: [
          {
            members: [member(LINA, "fmc"), member(CORIN, "mmc")],
            prominence: "primary",
          },
        ],
      }),
      false
    );
  });

  it("planFollowUpResearch med ikke-ready identity → romanceScope null", () => {
    const jobs = planJobs({ fields: [PROTECTIVE, BODYGUARD, THAD], romance: null });
    assert.ok(jobs.length >= 1);
    assert.equal(jobs[0].romanceScope, null);
  });
});

describe("seriesRomancePlanning candidate filtering", () => {
  it("vælger primary og aldrig secondary", () => {
    const romance = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            members: [member(LINA, "fmc"), member(CORIN, "mmc")],
            bookScopes: [{ bookNumber: 1 }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(TESS, "fmc"), member(ARDEN, "mmc")],
            bookScopes: [{ bookNumber: 2 }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(NORA, "fmc"), member(ELIN, "mmc")],
            bookScopes: [{ bookNumber: 0, title: "Early side arc" }],
            prominence: "secondary",
          },
        ],
      })
    );
    const scope = selectRomanceScopeForJob({
      seriesRomanceIdentity: romance,
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.deepEqual(scope.memberNames, [CORIN, LINA].sort());
  });

  it("vælger aldrig unscoped primary", () => {
    const romance = rotatingPairings();
    const scope = selectRomanceScopeForJob({
      seriesRomanceIdentity: romance,
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.ok(scope);
    for (const pairing of primaryPairings(romance)) {
      if (!pairingHasScope(pairing)) {
        assert.notDeepEqual(
          scope.memberNames,
          sortedDisplayMemberNames(pairing.members)
        );
      }
    }
  });

  it("modelleveret pairing.id styrer ikke valget", () => {
    const scope = selectRomanceScopeForJob({
      seriesRomanceIdentity: threePairingRotatingPermuted(0),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.deepEqual(scope.memberNames, [CORIN, LINA].sort());
    assert.equal(scope.bookScopes[0].bookNumber, 1);
  });
});

describe("seriesRomancePlanning determinism", () => {
  it("pairing/member/scope array-order ændrer ikke selection", () => {
    const scopes = [0, 1, 2].map((order) =>
      selectRomanceScopeForJob({
        seriesRomanceIdentity: threePairingRotatingPermuted(order),
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE],
      })
    );
    assert.deepEqual(scopes[0], scopes[1]);
    assert.deepEqual(scopes[1], scopes[2]);
  });

  it("prioriterer laveste bookNumber, arc-key, member names før id", () => {
    const withArc = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            id: "aaa-model-first",
            members: [member("Zed", "mmc"), member("Amy", "fmc")],
            arcScopes: [{ id: "z-last", label: "Late arc" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            id: "zzz-model-last",
            members: [member(CORIN, "mmc"), member(LINA, "fmc")],
            bookScopes: [{ bookNumber: 1 }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
        ],
      })
    );
    const chosen = selectRomanceScopeForJob({
      seriesRomanceIdentity: withArc,
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.equal(chosen.bookScopes[0].bookNumber, 1);
    assert.deepEqual(chosen.memberNames, [CORIN, LINA].sort());
  });

  it("semantic key er uafhængig af modelleveret pairing.id", () => {
    const shared = {
      memberNames: [CORIN, LINA],
      bookScopes: [{ bookNumber: 1, title: "Glass One" }],
      arcScopes: [],
    };
    const keyA = semanticPairingKey({
      ...shared,
      pairingId: "model-a",
    });
    const keyB = semanticPairingKey({
      ...shared,
      pairingId: "model-b",
    });
    assert.equal(keyA, keyB);
  });

  it("bookScopes og arcScopes array-order ændrer ikke semantic key", () => {
    const base = semanticPairingKey({
      memberNames: [CORIN, LINA],
      bookScopes: [
        { bookNumber: 2, title: "Two" },
        { bookNumber: 1, title: "One" },
      ],
      arcScopes: [{ id: "b" }, { id: "a" }],
    });
    const permuted = semanticPairingKey({
      memberNames: [LINA, CORIN],
      bookScopes: [
        { bookNumber: 1, title: "One" },
        { bookNumber: 2, title: "Two" },
      ],
      arcScopes: [{ id: "a" }, { id: "b" }],
    });
    assert.equal(base, permuted);
  });
});

describe("seriesRomancePlanning same-round scheduling", () => {
  it("to eligible jobs vælger ikke samme pairing", () => {
    const jobs = planJobs({
      fields: [PROTECTIVE, RHYSAND],
      romance: rotatingPairings(),
      maxJobs: 2,
    });
    const scoped = jobs.filter((job) => job.romanceScope);
    assert.equal(scoped.length, 2);
    const keys = scoped.map((job) => semanticPairingKey(job.romanceScope));
    assert.equal(new Set(keys).size, 2);
  });

  it("tre jobs og tre pairings kan vælge tre distinct scopes", () => {
    const romance = threePairingRotatingPermuted(0);
    const plannedSemanticPairingKeys = new Set();
    const scopes = ["a", "b", "c"].map((strategy, index) => {
      const targetFields =
        index === 0 ? [PROTECTIVE] : index === 1 ? [RHYSAND] : [FMC_DEV];
      const scope = selectRomanceScopeForJob({
        seriesRomanceIdentity: romance,
        strategy,
        targetFields,
        plannedSemanticPairingKeys,
      });
      if (scope) {
        plannedSemanticPairingKeys.add(semanticPairingKey(scope));
      }
      return scope;
    });
    assert.equal(scopes.filter(Boolean).length, 3);
    assert.equal(new Set(scopes.map((scope) => semanticPairingKey(scope))).size, 3);
  });

  it("flere jobs end pairings → resterende jobs får romanceScope null", () => {
    const jobs = planJobs({
      fields: [PROTECTIVE, RHYSAND, FMC_DEV],
      romance: rotatingPairings(),
      maxJobs: 3,
    });
    const scopedCount = jobs.filter((job) => job.romanceScope).length;
    assert.equal(scopedCount, 2);
    assert.ok(jobs.some((job) => job.romanceScope === null));
  });

  it("same-round Set er lokalt og lækker ikke mellem separate planner-kald", () => {
    const first = planJobs({
      fields: [PROTECTIVE],
      romance: rotatingPairings(),
      maxJobs: 1,
    });
    const second = planJobs({
      fields: [RHYSAND],
      romance: rotatingPairings(),
      maxJobs: 1,
    });
    assert.ok(first[0].romanceScope);
    assert.ok(second[0].romanceScope);
    assert.equal(
      semanticPairingKey(first[0].romanceScope),
      semanticPairingKey(second[0].romanceScope)
    );
  });
});

describe("seriesRomancePlanning previous-round history", () => {
  it("successful og failed executed traces tæller som attempted", () => {
    const scope = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const previousRounds = [
      {
        jobs: [
          { strategy: "hero_protective_dynamic", targetFields: [PROTECTIVE], romanceScope: scope, ok: true },
          { strategy: "hero_protective_dynamic", targetFields: [PROTECTIVE], romanceScope: scope, ok: false },
        ],
      },
    ];
    const attempted = collectAttemptedSemanticKeys({
      previousRounds,
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.equal(attempted.size, 1);
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
      previousRounds,
    });
    assert.notDeepEqual(next.memberNames, scope.memberNames);
  });

  it("same-round plannedSemanticPairingKeys udelukker pairing inden for ét planner-kald", () => {
    const scope = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
      previousRounds: [],
      plannedSemanticPairingKeys: new Set([semanticPairingKey(scope)]),
    });
    assert.notDeepEqual(next.memberNames, scope.memberNames);
  });

  it("same strategy + sorted fields vælger næste pairing", () => {
    const firstScope = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const targetFields = [PROTECTIVE, BODYGUARD, THAD];
    const jobs = planJobs({
      fields: targetFields,
      romance: rotatingPairings(),
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields,
              romanceScope: firstScope,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.notDeepEqual(jobs[0].romanceScope.memberNames, firstScope.memberNames);
  });

  it("field-order i trace ændrer ikke attempted matching", () => {
    const scope = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const keyA = scopeAttemptKey({
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE, BODYGUARD, THAD],
      romanceScope: scope,
    });
    const keyB = scopeAttemptKey({
      strategy: "hero_protective_dynamic",
      targetFields: [THAD, PROTECTIVE, BODYGUARD],
      romanceScope: scope,
    });
    assert.equal(keyA, keyB);
    assert.equal(
      fieldScopeAttemptKey({
        strategy: "hero_protective_dynamic",
        field: PROTECTIVE,
        romanceScope: scope,
      }),
      fieldScopeAttemptKey({
        strategy: "hero_protective_dynamic",
        field: PROTECTIVE,
        romanceScope: scope,
      })
    );
  });

  it("ældre trace uden romanceScope ignoreres sikkert", () => {
    const attempted = collectAttemptedSemanticKeys({
      previousRounds: [{ jobs: [{ strategy: "hero_protective_dynamic", targetFields: [PROTECTIVE], ok: true }] }],
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
    });
    assert.equal(attempted.size, 0);
  });

  it("null scope forbruger ikke pairing-slot og exhaustion giver null", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const second = buildRomanceScope(rotatingPairings().pairings[1], "rotating_couples");
    const targetFields = [PROTECTIVE, BODYGUARD, THAD];
    const jobs = planJobs({
      fields: targetFields,
      romance: rotatingPairings(),
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields,
              romanceScope: first,
              ok: true,
            },
            {
              strategy: "hero_protective_dynamic",
              targetFields,
              romanceScope: null,
              ok: true,
            },
            {
              strategy: "hero_protective_dynamic",
              targetFields,
              romanceScope: second,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.equal(jobs[0].romanceScope, null);
  });

  it("previous [Protective], current [Protective, Bodyguard] udelukker pairing", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE, BODYGUARD],
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.ok(next);
    assert.notDeepEqual(next.memberNames, first.memberNames);
  });

  it("previous [Protective, Bodyguard], current [Protective] udelukker pairing", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE],
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE, BODYGUARD],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.ok(next);
    assert.notDeepEqual(next.memberNames, first.memberNames);
  });

  it("previous [Protective], current [Bodyguard] uden overlap tillader samme pairing", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const attempted = collectAttemptedSemanticKeys({
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
      strategy: "hero_protective_dynamic",
      targetFields: [BODYGUARD],
    });
    assert.equal(attempted.size, 0);
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [BODYGUARD],
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.deepEqual(next.memberNames, first.memberNames);
  });

  it("anden strategy med overlapping field er ikke samme attempt", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const attempted = collectAttemptedSemanticKeys({
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
      strategy: "hero_respect_agency",
      targetFields: [RHYSAND],
    });
    assert.equal(attempted.size, 0);
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_respect_agency",
      targetFields: [RHYSAND],
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: true,
            },
          ],
        },
      ],
    });
    assert.deepEqual(next.memberNames, first.memberNames);
  });

  it("failed executed overlapping field udelukker pairing", () => {
    const first = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE, BODYGUARD],
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: first,
              ok: false,
              error: "boom",
            },
          ],
        },
      ],
    });
    assert.ok(next);
    assert.notDeepEqual(next.memberNames, first.memberNames);
  });

  it("malformed romanceScope i trace crasher ikke og skaber ikke attempted", () => {
    const attempted = collectAttemptedSemanticKeys({
      previousRounds: [
        {
          jobs: [
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: "not-an-object",
              ok: true,
            },
            {
              strategy: "hero_protective_dynamic",
              targetFields: [PROTECTIVE],
              romanceScope: { memberNames: null, bookScopes: 12 },
              ok: true,
            },
          ],
        },
      ],
      strategy: "hero_protective_dynamic",
      targetFields: [PROTECTIVE, BODYGUARD],
    });
    assert.equal(attempted.size, 0);
  });

  it("alle candidates attempted for overlapping fields → romanceScope null", () => {
    const romance = rotatingPairings();
    const previousRounds = [
      {
        jobs: romance.pairings.map((pairing) => ({
          strategy: "hero_protective_dynamic",
          targetFields: [PROTECTIVE],
          romanceScope: buildRomanceScope(pairing, "rotating_couples"),
          ok: true,
        })),
      },
    ];
    assert.equal(
      selectRomanceScopeForJob({
        seriesRomanceIdentity: romance,
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE, BODYGUARD],
        previousRounds,
      }),
      null
    );
  });
});

describe("seriesRomancePlanning job shape and isolation", () => {
  it("scoped job bruger præcis romanceScope-shape", () => {
    const jobs = planJobs({
      fields: [PROTECTIVE, BODYGUARD, THAD],
      romance: rotatingPairings(),
    });
    const scope = jobs[0].romanceScope;
    assert.ok(scope);
    assert.ok("pairingId" in scope);
    assert.ok("memberNames" in scope);
    assert.ok("bookScopes" in scope);
    assert.ok("arcScopes" in scope);
    assert.ok("topology" in scope);
    assert.equal("id" in scope, false);
    assert.equal("members" in scope, false);
    assert.equal(scope.topology, "rotating_couples");
  });

  it("scope-arrays er defensive kopier", () => {
    const pairing = normalizeRomancePairing(rotatingPairings().pairings[0], 0);
    const scope = buildRomanceScope(pairing, "rotating_couples");
    pairing.bookScopes[0].bookNumber = 99;
    pairing.members[0].name = "Changed";
    assert.notEqual(scope.bookScopes[0].bookNumber, 99);
    assert.notEqual(scope.memberNames[0], "Changed");
  });

  it("mutation af job efter trace copy ændrer ikke trace-scope", () => {
    const scope = buildRomanceScope(rotatingPairings().pairings[0], "rotating_couples");
    const job = { romanceScope: scope };
    const traceScope = defensiveCopyRomanceScope(job.romanceScope);
    job.romanceScope.bookScopes[0].bookNumber = 77;
    assert.notEqual(traceScope.bookScopes[0].bookNumber, 77);
  });

  it("planFollowUpResearch ændrer ikke retrieval metadata", () => {
    const baseline = planJobs({
      fields: [PROTECTIVE, BODYGUARD, THAD],
      romance: null,
    })[0];
    const scoped = planJobs({
      fields: [PROTECTIVE, BODYGUARD, THAD],
      romance: rotatingPairings(),
    })[0];
    assert.equal(scoped.retrievalMode, baseline.retrievalMode);
    assert.deepEqual(scoped.preferredSourceRoles, baseline.preferredSourceRoles);
    assert.deepEqual(scoped.retrievalApproaches, baseline.retrievalApproaches);
    assert.deepEqual(scoped.queryHints, baseline.queryHints);
    assert.equal(scoped.userPrompt, baseline.userPrompt);
    assert.ok(scoped.romanceScope);
  });

  it("ineligible og mixed jobs forbliver unscoped", () => {
    assert.equal(
      selectRomanceScopeForJob({
        seriesRomanceIdentity: rotatingPairings(),
        strategy: "romance_spice",
        targetFields: [SPICE],
      }),
      null
    );
    assert.equal(
      selectRomanceScopeForJob({
        seriesRomanceIdentity: rotatingPairings(),
        strategy: "heroine_growth",
        targetFields: [FMC_DEV, CHAR_DEV],
      }),
      null
    );
  });
});

describe("seriesRomancePlanning regression and version", () => {
  it("ADAPTIVE_VERSION === adaptive-v13", () => {
    assert.equal(ADAPTIVE_VERSION, "adaptive-v13");
  });

  it("comparePairingSelection og pairingSelectionSortKey er stabile", () => {
    const a = normalizeRomancePairing(
      {
        id: "model-a",
        members: [member(LINA, "fmc"), member(CORIN, "mmc")],
        bookScopes: [{ bookNumber: 1 }],
        prominence: "primary",
      },
      0
    );
    const b = normalizeRomancePairing(
      {
        id: "model-b",
        members: [member(TESS, "fmc"), member(ARDEN, "mmc")],
        bookScopes: [{ bookNumber: 2 }],
        prominence: "primary",
      },
      1
    );
    assert.ok(comparePairingSelection(a, b) < 0);
    assert.ok(pairingSelectionSortKey(a).bookNumber === 1);
  });
});

describe("seriesRomancePlanning jobTrace loop integration", () => {
  const seriesId = {
    title: "The Glass Cycle",
    author: "A. Writer",
    series: "The Glass Cycle",
    firstBook: "Glass One",
  };

  function weakAssessments() {
    return Object.fromEntries(
      SUBJECTIVE_KEYS.map((field) => [
        field,
        assessment({
          score: 3,
          confidence: "low",
          basis: "ai_inference",
          evidenceSourceIds: [],
        }),
      ])
    );
  }

  function analysisWith(assessments) {
    return {
      row: { "Seriens navn": seriesId.series },
      meta: { assessments, estimatedCostUsd: 0.02 },
    };
  }

  function scopedResearch() {
    return researchWith({
      seriesRomanceIdentity: rotatingPairings(),
      seriesIdentity: {
        mmc: CORIN,
        fmc: LINA,
        confidence: "high",
        basis: ["central_pairing"],
        alternatives: [],
        resolution: { resolved: true, reason: "series_endgame_supported" },
      },
      identityHint: { fmc: LINA, mmc: CORIN, confidence: "high" },
      sources: [],
    });
  }

  it("successful executed scoped job gemmer strategy/targetFields/romanceScope i jobTrace", async () => {
    const result = await runAdaptiveResearch({
      identity: seriesId,
      initialResearch: scopedResearch(),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                title: "Review",
                url: "https://reviews.example.com/scoped-success",
                type: "blog",
                summary:
                  "Corin protects Lina. Bodyguard vibe and touch her and die energy. Agency respected.",
                batch: "helteprofil",
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async ({ sources }) => ({
          parsed: {
            identity: seriesId,
            facts: {},
            ratings: {},
            reviewConsensus: {},
            sources,
          },
          costUsd: 0.005,
        }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.ok(result.adaptive.rounds.length >= 1);
    const scopedTrace = result.adaptive.rounds[0].jobs.find(
      (job) => job.romanceScope && job.ok === true
    );
    assert.ok(scopedTrace, "expected a successful scoped jobTrace entry");
    assert.equal(typeof scopedTrace.strategy, "string");
    assert.ok(Array.isArray(scopedTrace.targetFields));
    assert.ok(scopedTrace.targetFields.length > 0);
    assert.equal(scopedTrace.ok, true);
    assert.equal("pairingId" in scopedTrace.romanceScope, true);
    assert.equal("memberNames" in scopedTrace.romanceScope, true);
    assert.equal("bookScopes" in scopedTrace.romanceScope, true);
    assert.equal("arcScopes" in scopedTrace.romanceScope, true);
    assert.equal("topology" in scopedTrace.romanceScope, true);
    assert.equal("id" in scopedTrace.romanceScope, false);
    assert.equal("members" in scopedTrace.romanceScope, false);
    assert.ok(scopedTrace.scopedRecordsStored >= 1);
    assert.ok(result.research.scopedRetrieval?.records?.length >= 1);
    const legacyUrls = (result.research.sources || []).map((s) => s.url);
    assert.equal(
      legacyUrls.includes("https://reviews.example.com/scoped-success"),
      false
    );
  });

  it("failed executed scoped job bevarer romanceScope i jobTrace og tæller som attempted", async () => {
    let calls = 0;
    const result = await runAdaptiveResearch({
      identity: seriesId,
      initialResearch: scopedResearch(),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 3,
        executeFollowUpJob: async ({ job }) => {
          calls += 1;
          if (job.romanceScope) {
            throw new Error("scoped job failed");
          }
          return {
            sources: [],
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          throw new Error("no synth on failed round");
        },
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.ok(calls >= 1);
    assert.ok(result.adaptive.rounds.length >= 1);
    const failed = result.adaptive.rounds[0].jobs.find(
      (job) => job.ok === false && job.romanceScope
    );
    assert.ok(failed, "expected failed scoped jobTrace entry");
    assert.equal(typeof failed.strategy, "string");
    assert.ok(Array.isArray(failed.targetFields));
    assert.equal(failed.ok, false);
    assert.ok(failed.romanceScope.pairingId);
    assert.ok(Array.isArray(failed.romanceScope.memberNames));

    const next = selectRomanceScopeForJob({
      seriesRomanceIdentity: rotatingPairings(),
      strategy: failed.strategy,
      targetFields: failed.targetFields,
      previousRounds: result.adaptive.rounds,
    });
    if (next) {
      assert.notEqual(
        semanticPairingKey(next),
        semanticPairingKey(failed.romanceScope)
      );
    }
  });

  it("budget-stoppet job når aldrig executeFollowUpJob og tæller ikke som attempted", async () => {
    const startedJobIds = [];
    const result = await runAdaptiveResearch({
      identity: seriesId,
      initialResearch: scopedResearch(),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 1,
        executeFollowUpJob: async ({ job, round }) => {
          startedJobIds.push(job.id);
          return {
            sources: prepareFollowUpSources(
              [
                {
                  title: "Partial",
                  url: "https://reviews.example.com/budget-one",
                  type: "blog",
                  summary: "Protective hero behavior for Lina and Corin.",
                  batch: "helteprofil",
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
            identity: seriesId,
            facts: {},
            ratings: {},
            reviewConsensus: {},
            sources,
          },
          costUsd: 0.005,
        }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.equal(startedJobIds.length, 1);
    assert.ok(result.adaptive.rounds.length >= 1);
    const tracedIds = result.adaptive.rounds[0].jobs.map((job) => job.id);
    assert.deepEqual(tracedIds, startedJobIds);
    assert.equal(result.adaptive.rounds[0].jobs.length, 1);

    const plannedButNotStarted = planJobs({
      fields: [PROTECTIVE, RHYSAND],
      romance: rotatingPairings(),
      maxJobs: 2,
    });
    assert.ok(plannedButNotStarted.length >= 2);
    const secondPlannedScope = plannedButNotStarted[1].romanceScope;
    assert.ok(secondPlannedScope);

    const attemptedFromTrace = collectAttemptedSemanticKeys({
      previousRounds: result.adaptive.rounds,
      strategy: plannedButNotStarted[1].strategy,
      targetFields: plannedButNotStarted[1].targetFields,
    });
    // Only the executed job's scope (if same strategy/overlap) can appear;
    // a never-started second planned job is absent from jobTrace.
    assert.equal(
      result.adaptive.rounds[0].jobs.some(
        (job) =>
          job.romanceScope &&
          semanticPairingKey(job.romanceScope) ===
            semanticPairingKey(secondPlannedScope)
      ),
      false
    );
    assert.equal(
      attemptedFromTrace.has(semanticPairingKey(secondPlannedScope)),
      false
    );
  });
});

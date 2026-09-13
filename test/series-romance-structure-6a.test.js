import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  ADAPTIVE_VERSION,
  ANALYSIS_MODEL,
  ANALYSIS_PROMPT_VERSION,
  SCOPED_ASSESSMENT_PROMPT_VERSION,
  SCOPED_ASSESSMENT_VERSION,
  SCOPED_COVERAGE_VERSION,
  SUBJECT_BINDING_VERSION,
} from "../server/services/versions.js";
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
import {
  buildIdentityFingerprint,
  bindScopedRetrievalRecord,
} from "../server/services/seriesRomanceSubjectBinding.js";
import { buildScopedCoverage } from "../server/services/seriesRomanceScopedCoverage.js";
import {
  PAIRING_SCOPED_V1,
  SERIES_GLOBAL_V1,
  buildScopedAssessmentRequests,
  buildScopedAssessmentInputFingerprint,
  buildScopedAssessmentTaxonomy,
  canReuseScopedAssessments,
  clearScopedAssessmentArtifacts,
  finalizeScopedAssessments,
  isScopedAssessmentActivationReady,
  mergeScopedUsageIntoPipelineUsage,
  normalizeScopedAssessment,
  normalizeScopedAssessmentModelOutput,
  normalizeScopedScore,
  buildScopedAssessmentRecordIndex,
} from "../server/services/seriesRomanceScopedAssessment.js";
import { finalizeScopedOnReusedAnalysis } from "../server/services/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const SPICE = "Spice/erotik (0-5)";

const ALFA = "Alfa";
const BETA = "Beta";
const GAMMA = "Gamma";
const DELTA = "Delta";
const EPSILON = "Epsilon";

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "high",
    basis: "source_consensus",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 2,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function assessmentsAll(over = {}) {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((field) => [field, assessment(over)])
  );
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
          alternatives: [{ name: EPSILON, role: "early_love_interest" }],
        },
        {
          id: "pair-gd",
          members: [member(DELTA, "fmc"), member(GAMMA, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
          arcScopes: [{ id: "arc-b", label: "Dusk Arc" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          id: "pair-sec",
          members: [member("Zeta", "fmc"), member("Eta", "mmc")],
          bookScopes: [{ bookNumber: 3, title: "Alpha Three" }],
          prominence: "secondary",
          relation: PAIRING_RELATIONS.SECONDARY,
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

function scopedJob(romance, pairingIndex, fields = [PROTECTIVE, BODYGUARD, THAD]) {
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

function prepared(over = {}) {
  return {
    title: "Review",
    url: "https://reviews.example.com/scoped-assess",
    type: "blog",
    batch: "helteprofil",
    summary: "Protective dynamic discussed.",
    focus: "hero_protective_dynamic",
    followUpJobId: "followup-protective-r1-1",
    retrievalAttempt: 1,
    retrievalStrategy: "primary",
    ...over,
  };
}

function makeBoundRecord({
  romance,
  pairingIndex = 0,
  summary,
  url,
  fields,
  mutateBinding,
} = {}) {
  const job = scopedJob(romance, pairingIndex, fields);
  const record = buildScopedRetrievalRecord(
    prepared({
      summary,
      url:
        url ||
        `https://reviews.example.com/${encodeURIComponent(summary.slice(0, 28))}`,
    }),
    job,
    1
  );
  const bound = bindScopedRetrievalRecord(record, romance);
  if (mutateBinding) mutateBinding(bound);
  return bound;
}

function researchWithRecords(romance, records) {
  return {
    identity: { title: "Alpha Cycle", author: "Author", series: "Alpha Cycle" },
    seriesRomanceIdentity: romance,
    sources: [],
    scopedRetrieval: {
      version: "scoped-retrieval-v1",
      records,
    },
    meta: { webSearchCalls: 2, inputTokens: 10, outputTokens: 5 },
  };
}

function analysisShell(over = {}) {
  return {
    reused: false,
    row: {
      "Seriens navn": "Alpha Cycle",
      "Tine-score": 80,
      Indholdsmatch: 80,
      "Læseprioritet nu": 70,
      "Tines score": 91,
      "Tines egen vurdering": "Elsker den",
      [PROTECTIVE]: 4,
      [SPICE]: 3,
    },
    meta: {
      promptVersion: ANALYSIS_PROMPT_VERSION,
      assessments: assessmentsAll(),
      inputTokens: 100,
      outputTokens: 40,
      estimatedCostUsd: 0.01,
      ...over.meta,
    },
    ...over,
  };
}

function protectiveSummaries(romance, pairingIndex, names) {
  const pairing = romance.pairings[pairingIndex];
  const [mmc, fmc] = [
    pairing.members.find((m) => m.slot === "mmc")?.name,
    pairing.members.find((m) => m.slot === "fmc")?.name,
  ];
  return names.map(
    (n, i) =>
      `${mmc} protects ${fmc} fiercely in scene ${n}; bodyguard energy and touch-her-and-die loyalty. Review ${i + 1}.`
  );
}

describe("Structure 6A scoped assessments", () => {
  it("locks five-field taxonomy without Spice or global fallback fields", () => {
    const tax = buildScopedAssessmentTaxonomy();
    assert.deepEqual(tax.pairingScoped, [...ROMANCE_SCOPE_ELIGIBLE_FIELDS]);
    assert.deepEqual(PAIRING_SCOPED_V1, [...ROMANCE_SCOPE_ELIGIBLE_FIELDS]);
    assert.equal(PAIRING_SCOPED_V1.length, 5);
    assert.equal(PAIRING_SCOPED_V1.includes(SPICE), false);
    assert.equal(
      PAIRING_SCOPED_V1.includes("Spice/erotik kvalitet (0-5)"),
      false
    );
    assert.equal(PAIRING_SCOPED_V1.includes("Romance i fokus (0-100%)"), false);
    assert.equal(SERIES_GLOBAL_V1.includes(SPICE), true);
    assert.equal(SERIES_GLOBAL_V1.includes(PROTECTIVE), false);
    assert.equal(
      SERIES_GLOBAL_V1.length + PAIRING_SCOPED_V1.length,
      SUBJECTIVE_KEYS.length
    );
    assert.equal(ADAPTIVE_VERSION, "adaptive-v15");
    assert.equal(SCOPED_COVERAGE_VERSION, "scoped-coverage-v1");
    assert.equal(SUBJECT_BINDING_VERSION, "subject-binding-v1");
    assert.equal(SCOPED_ASSESSMENT_VERSION, "scoped-assessment-v1");
    assert.equal(
      SCOPED_ASSESSMENT_PROMPT_VERSION,
      "scoped-assessment-prompt-v1"
    );
    assert.equal(ANALYSIS_PROMPT_VERSION, "analysis-v16");
  });

  it("activates from final sidecar coverage and builds multi-pair requests", () => {
    const romance = rotatingIdentity();
    const records = [
      makeBoundRecord({
        romance,
        pairingIndex: 0,
        summary: protectiveSummaries(romance, 0, ["A"])[0],
        fields: [PROTECTIVE],
      }),
      makeBoundRecord({
        romance,
        pairingIndex: 1,
        summary: protectiveSummaries(romance, 1, ["B"])[0],
        fields: [PROTECTIVE],
        url: "https://reviews.example.com/pair-b-1",
      }),
    ];
    const research = researchWithRecords(romance, records);
    const scoped = buildScopedCoverage({ research });
    const coverage = { scoped };
    const fingerprint = buildIdentityFingerprint(romance);
    assert.equal(
      isScopedAssessmentActivationReady({
        research,
        coverage,
        identityFingerprint: fingerprint,
      }),
      true
    );
    const requests = buildScopedAssessmentRequests({
      research,
      coverage,
      identityFingerprint: fingerprint,
    });
    const pairingRequests = requests.filter((r) => r.subjectBucket === "pairings");
    assert.ok(pairingRequests.length >= 10); // 2 primaries × 5 fields
    const fields = new Set(pairingRequests.map((r) => r.field));
    assert.deepEqual([...fields].sort(), [...PAIRING_SCOPED_V1].sort());
    assert.equal(requests.some((r) => r.field === SPICE), false);
  });

  it("includes scoped-only final records and rejects mixed/stale/unresolved", async () => {
    const romance = rotatingIdentity();
    const good = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["good"])[0],
      fields: [PROTECTIVE, BODYGUARD],
    });
    const mixed = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["mixed"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/mixed",
      mutateBinding: (bound) => {
        bound.subjectBinding.status = "mixed";
      },
    });
    const stale = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["stale"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/stale",
      mutateBinding: (bound) => {
        bound.subjectBinding.identityFingerprint = "stale-fingerprint";
      },
    });
    const unresolved = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["unresolved"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/unresolved",
      mutateBinding: (bound) => {
        bound.subjectBinding.status = "unresolved";
      },
    });
    const research = researchWithRecords(romance, [
      good,
      mixed,
      stale,
      unresolved,
    ]);
    const scoped = buildScopedCoverage({ research });
    const requests = buildScopedAssessmentRequests({
      research,
      coverage: { scoped },
      identityFingerprint: buildIdentityFingerprint(romance),
    });
    const protective = requests.find(
      (r) =>
        r.field === PROTECTIVE &&
        r.semanticPairingKey === pairingKey(romance, 0)
    );
    assert.ok(protective);
    assert.ok(protective.allowedRecordIds.includes(good.id));
    assert.equal(protective.allowedRecordIds.includes(mixed.id), false);
    assert.equal(protective.allowedRecordIds.includes(stale.id), false);
    assert.equal(protective.allowedRecordIds.includes(unresolved.id), false);
  });

  it("makes one batched model call and zero calls without eligible evidence", async () => {
    const romance = rotatingIdentity();
    const records = [
      makeBoundRecord({
        romance,
        pairingIndex: 0,
        summary: protectiveSummaries(romance, 0, ["A1"])[0],
        fields: [PROTECTIVE],
        url: "https://reviews.example.com/a1",
      }),
      makeBoundRecord({
        romance,
        pairingIndex: 0,
        summary: protectiveSummaries(romance, 0, ["A2"])[0],
        fields: [PROTECTIVE],
        url: "https://reviews.example.com/a2",
      }),
      makeBoundRecord({
        romance,
        pairingIndex: 1,
        summary: protectiveSummaries(romance, 1, ["B1"])[0],
        fields: [BODYGUARD],
        url: "https://reviews.example.com/b1",
      }),
    ];
    const research = researchWithRecords(romance, records);
    let calls = 0;
    const result = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => {
          calls += 1;
          assert.ok(requests.length >= 2);
          return {
            ok: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 11,
              outputTokens: 7,
              estimatedCostUsd: 0.001,
            },
            modelOutput: {
              assessments: requests.map((r) => ({
                requestId: r.requestId,
                score: 4,
                confidence: "high",
                basis: "source_consensus",
                reason: "Scoped evidence",
                evidenceRecordIds: r.allowedRecordIds.slice(0, 2),
                conflictingRecordIds: [],
              })),
            },
          };
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.modelCalls, 1);
    assert.equal(result.analysis.meta.scopedAssessments.status, "ready");
    assert.equal(result.analysis.meta.scopedAssessments.usage.inputTokens, 11);

    const emptyResearch = researchWithRecords(romance, []);
    let emptyCalls = 0;
    const empty = await finalizeScopedAssessments({
      research: emptyResearch,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async () => {
          emptyCalls += 1;
          return { ok: true, usage: {}, modelOutput: { assessments: [] } };
        },
      },
    });
    assert.equal(emptyCalls, 0);
    assert.equal(empty.modelCalls, 0);
    assert.equal(
      empty.analysis.meta.scopedAssessments.status,
      "insufficient_scope"
    );
  });

  it("enforces per-request allow-list and derives identity keys in code", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["allow"])[0],
      fields: [PROTECTIVE],
    });
    const foreignId = "scoped-retrieval-foreign";
    const normalized = normalizeScopedAssessment({
      raw: {
        score: 5,
        confidence: "high",
        basis: "source_consensus",
        reason: "test",
        evidenceRecordIds: [record.id, foreignId],
        conflictingRecordIds: [foreignId],
        evidenceIdentityKeys: ["forged-key"],
      },
      allowedRecordIds: [record.id],
      recordById: new Map([[record.id, record]]),
      coverageCellKeys: ["cell-a"],
    });
    assert.deepEqual(normalized.evidenceRecordIds, [record.id]);
    assert.equal(normalized.conflictingRecordIds.includes(foreignId), false);
    assert.deepEqual(normalized.evidenceIdentityKeys, [
      record.sourceIdentity.identityKey,
    ]);
    assert.equal(normalized.evidenceIdentityKeys.includes("forged-key"), false);
  });

  it("fails closed on malformed/unknown/duplicate/non-copyable model output", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["x"])[0],
      fields: [PROTECTIVE],
    });
    const request = {
      requestId: "scoped-req-test",
      coverageCellKeys: ["c1"],
      allowedRecordIds: [record.id],
    };
    const malformed = normalizeScopedAssessmentModelOutput({
      modelOutput: null,
      requests: [request],
      recordById: new Map([[record.id, record]]),
    });
    assert.equal(malformed.failedClosed, true);
    assert.equal(malformed.byRequestId.get(request.requestId).score, null);

    const unknown = normalizeScopedAssessmentModelOutput({
      modelOutput: {
        assessments: [
          {
            requestId: "unknown",
            score: 5,
            evidenceRecordIds: [record.id],
            basis: "source_consensus",
            confidence: "high",
          },
        ],
      },
      requests: [request],
      recordById: new Map([[record.id, record]]),
    });
    assert.ok(unknown.reasons.includes("unknown_request_id"));
    assert.equal(unknown.byRequestId.get(request.requestId).score, null);

    const dup = normalizeScopedAssessmentModelOutput({
      modelOutput: {
        assessments: [
          {
            requestId: request.requestId,
            score: 4,
            confidence: "medium",
            basis: "source_consensus",
            evidenceRecordIds: [record.id],
          },
          {
            requestId: request.requestId,
            score: 5,
            confidence: "high",
            basis: "source_consensus",
            evidenceRecordIds: [record.id],
          },
        ],
      },
      requests: [request],
      recordById: new Map([[record.id, record]]),
    });
    assert.ok(dup.reasons.includes("duplicate_request_id"));
    assert.equal(dup.byRequestId.get(request.requestId).score, null);

    const cyclic = {};
    cyclic.self = cyclic;
    assert.equal(normalizeScopedScore(cyclic), null);
  });

  it("clamps/rounds scores and caps high confidence", () => {
    assert.equal(normalizeScopedScore(4.6), 5);
    assert.equal(normalizeScopedScore(-1), 0);
    assert.equal(normalizeScopedScore(9), 5);
    assert.equal(normalizeScopedScore("3.2"), 3);
    assert.equal(normalizeScopedScore(NaN), null);

    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["one"])[0],
      fields: [PROTECTIVE],
    });
    const one = normalizeScopedAssessment({
      raw: {
        score: 5,
        confidence: "high",
        basis: "source_consensus",
        evidenceRecordIds: [record.id],
        reason: "one source",
      },
      allowedRecordIds: [record.id],
      recordById: new Map([[record.id, record]]),
    });
    assert.equal(one.confidence, "medium");

    const none = normalizeScopedAssessment({
      raw: {
        score: 5,
        confidence: "high",
        basis: "source_consensus",
        evidenceRecordIds: [],
        reason: "no evidence",
      },
      allowedRecordIds: [record.id],
      recordById: new Map([[record.id, record]]),
    });
    assert.equal(none.score, null);
    assert.equal(none.status, "insufficient");
    assert.equal(none.basis, "insufficient");
  });

  it("is order-invariant for identity/records/model arrays", async () => {
    const romance = rotatingIdentity();
    const r1 = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["ord1"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/ord1",
    });
    const r2 = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["ord2"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/ord2",
    });
    const r3 = makeBoundRecord({
      romance,
      pairingIndex: 1,
      summary: protectiveSummaries(romance, 1, ["ord3"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/ord3",
    });

    async function run(records) {
      const research = researchWithRecords(romance, records);
      return finalizeScopedAssessments({
        research,
        analysis: analysisShell(),
        deps: {
          callScopedAssessmentModel: async ({ requests }) => ({
            ok: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 1,
              outputTokens: 1,
              estimatedCostUsd: 0,
            },
            modelOutput: {
              assessments: [...requests]
                .reverse()
                .map((req) => ({
                  requestId: req.requestId,
                  score: 4,
                  confidence: "medium",
                  basis: "mixed_sources",
                  reason: "ok",
                  evidenceRecordIds: [...req.allowedRecordIds].reverse(),
                  conflictingRecordIds: [],
                })),
            },
          }),
        },
      });
    }

    const a = await run([r1, r2, r3]);
    const b = await run([r3, r1, r2]);
    assert.deepEqual(
      a.analysis.meta.scopedAssessments.pairings,
      b.analysis.meta.scopedAssessments.pairings
    );
    assert.equal(
      a.analysis.meta.scopedAssessments.inputFingerprint,
      b.analysis.meta.scopedAssessments.inputFingerprint
    );
  });

  it("reuses fresh cache and regenerates on stale input fingerprint", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["cache"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    let calls = 0;
    const deps = {
      callScopedAssessmentModel: async ({ requests }) => {
        calls += 1;
        return {
          ok: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 3,
            outputTokens: 2,
            estimatedCostUsd: 0.0001,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 3,
              confidence: "medium",
              basis: "source_consensus",
              reason: "cached",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        };
      },
    };
    const first = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps,
    });
    assert.equal(calls, 1);
    const second = await finalizeScopedAssessments({
      research,
      analysis: first.analysis,
      deps,
    });
    assert.equal(calls, 1);
    assert.equal(second.reused, true);

    const staleMeta = {
      ...first.analysis.meta,
      scopedAssessments: {
        ...first.analysis.meta.scopedAssessments,
        inputFingerprint: "stale-input",
      },
    };
    const third = await finalizeScopedAssessments({
      research,
      analysis: { ...first.analysis, meta: staleMeta },
      deps,
    });
    assert.equal(calls, 2);
    assert.equal(third.reused, false);
    assert.ok(
      canReuseScopedAssessments(first.analysis.meta.scopedAssessments, {
        identityFingerprint: first.analysis.meta.scopedAssessments.identityFingerprint,
        inputFingerprint: first.analysis.meta.scopedAssessments.inputFingerprint,
      })
    );
  });

  it("single_couple / unresolved / legacy are deep no-ops", async () => {
    const single = singleCoupleIdentity();
    const research = researchWithRecords(single, [
      makeBoundRecord({
        romance: single,
        pairingIndex: 0,
        summary: protectiveSummaries(single, 0, ["s"])[0],
        fields: [PROTECTIVE],
      }),
    ]);
    const analysis = analysisShell();
    const before = JSON.stringify(analysis.meta);
    const result = await finalizeScopedAssessments({
      research,
      analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          throw new Error("should not call");
        },
      },
    });
    assert.equal(result.inactive, true);
    assert.equal(result.changed, false);
    assert.equal(result.analysis.meta.scopedAssessments, undefined);
    assert.equal(JSON.stringify(result.analysis.meta), before);

    const unresolved = readyDiscovery(
      validateRomanceTopology({
        topology: "unknown",
        pairings: [],
      })
    );
    // force unresolved discovery semantics
    unresolved.discovery.resolved = false;
    unresolved.resolution = { resolved: false };
    const unresolvedResearch = researchWithRecords(unresolved, []);
    const u = await finalizeScopedAssessments({
      research: unresolvedResearch,
      analysis: analysisShell(),
    });
    assert.equal(u.inactive, true);
    assert.equal(u.analysis.meta.scopedAssessments, undefined);

    const legacy = {
      identity: { title: "Legacy" },
      sources: [],
      meta: {},
    };
    const l = await finalizeScopedAssessments({
      research: legacy,
      analysis: analysisShell(),
    });
    assert.equal(l.inactive, true);
  });

  it("preserves public/manual fields and attaches seriesAggregation without public mutation", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["pub"])[0],
      fields: [PROTECTIVE],
    });
    const analysis = analysisShell({
      meta: {
        assessments: assessmentsAll({ score: 4 }),
        seriesAggregation: { stale: true },
      },
    });
    const rowBefore = { ...analysis.row };
    const result = await finalizeScopedAssessments({
      research: researchWithRecords(romance, [record]),
      analysis,
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 2,
            outputTokens: 2,
            estimatedCostUsd: 0,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 2,
              confidence: "low",
              basis: "mixed_sources",
              reason: "diag",
              evidenceRecordIds: r.allowedRecordIds.slice(0, 1),
            })),
          },
        }),
        aggregationDeps: {
          loadLearnedTaste: () => ({
            version: "learned-taste-v1",
            scoredReviewCount: 0,
            fieldPrefs: {},
          }),
        },
      },
    });
    assert.equal(result.analysis.row["Tine-score"], rowBefore["Tine-score"]);
    assert.equal(result.analysis.row.Indholdsmatch, rowBefore.Indholdsmatch);
    assert.equal(
      result.analysis.row["Læseprioritet nu"],
      rowBefore["Læseprioritet nu"]
    );
    assert.equal(result.analysis.row["Tines score"], rowBefore["Tines score"]);
    assert.equal(
      result.analysis.row["Tines egen vurdering"],
      rowBefore["Tines egen vurdering"]
    );
    assert.ok(result.analysis.meta.seriesAggregation);
    assert.equal(
      result.analysis.meta.seriesAggregation.version,
      "series-aggregation-v1"
    );
    assert.equal(result.analysis.meta.seriesAggregation.stale, undefined);
    assert.equal(result.analysis.meta.seriesAggregation.generatedAt, undefined);
    assert.equal(result.analysis.meta.seriesAggregation.modelRaw, undefined);
    assert.ok(result.analysis.meta.scopedAssessments);
    assert.equal(result.analysis.meta.scopedAssessments.generatedAt, undefined);
    assert.equal(result.analysis.meta.scopedAssessments.modelRaw, undefined);
  });

  it("counts scoped usage without changing web-search budgets/counts", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["usage"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    research.meta.webSearchCalls = 4;
    const analysis = analysisShell();
    const beforeWeb = research.meta.webSearchCalls;
    const result = await finalizeScopedAssessments({
      research,
      analysis,
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 20,
            outputTokens: 8,
            estimatedCostUsd: 0.002,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 4,
              confidence: "medium",
              basis: "source_consensus",
              reason: "u",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        }),
      },
    });
    assert.equal(research.meta.webSearchCalls, beforeWeb);
    assert.equal(result.analysis.meta.scopedAssessmentInputTokens, 20);
    assert.equal(result.analysis.meta.inputTokens, 120);
    assert.equal(result.analysis.meta.scopedAssessments.usage.outputTokens, 8);
  });

  it("storage JSON round-trip preserves scopedAssessments", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["json"])[0],
      fields: [PROTECTIVE],
    });
    const result = await finalizeScopedAssessments({
      research: researchWithRecords(romance, [record]),
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 4,
              confidence: "medium",
              basis: "source_consensus",
              reason: "json",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        }),
      },
    });
    const round = JSON.parse(JSON.stringify(result.analysis.meta.scopedAssessments));
    assert.deepEqual(round, result.analysis.meta.scopedAssessments);
  });

  it("never uses global assessment as pairing fallback for the five fields", async () => {
    const romance = rotatingIdentity();
    const research = researchWithRecords(romance, []);
    const analysis = analysisShell({
      meta: {
        assessments: assessmentsAll({ score: 5, confidence: "high" }),
      },
    });
    const result = await finalizeScopedAssessments({
      research,
      analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          throw new Error("no call");
        },
      },
    });
    const pairing = result.analysis.meta.scopedAssessments.pairings[0];
    assert.ok(pairing);
    for (const field of PAIRING_SCOPED_V1) {
      assert.equal(pairing.assessments[field].score, null);
      assert.equal(pairing.assessments[field].status, "insufficient");
    }
  });

  it("pipeline owns Structure 6A finalizer (not adaptiveResearchLoop)", () => {
    const pipeline = readFileSync(
      join(ROOT, "server/services/pipeline.js"),
      "utf8"
    );
    const loop = readFileSync(
      join(ROOT, "server/services/adaptiveResearchLoop.js"),
      "utf8"
    );
    assert.match(pipeline, /finalizeScopedAssessments/);
    assert.match(pipeline, /finalizeScopedOnReusedAnalysis/);
    assert.match(pipeline, /analyzeNewSeries/);
    assert.match(pipeline, /refreshSeriesResearch/);
    assert.match(pipeline, /reanalyzeSeries/);
    assert.equal(loop.includes("finalizeScopedAssessments"), false);
    assert.equal(loop.includes("scopedAssessments"), false);
  });

  it("soft API failure preserves legacy analysis and attaches error status", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["err"])[0],
      fields: [PROTECTIVE],
    });
    const analysis = analysisShell();
    const result = await finalizeScopedAssessments({
      research: researchWithRecords(romance, [record]),
      analysis,
      deps: {
        callScopedAssessmentModel: async () => ({
          ok: false,
          error: "parse_failure",
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 4,
            outputTokens: 0,
            estimatedCostUsd: 0,
          },
          modelOutput: null,
        }),
      },
    });
    assert.equal(result.analysis.meta.scopedAssessments.status, "error");
    assert.equal(result.modelCalls, 1);
    assert.equal(result.analysis.row["Tine-score"], 80);
    assert.equal(result.analysis.meta.assessments[PROTECTIVE].score, 3);
  });

  it("buildScopedAssessmentInputFingerprint is order-stable", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["fp"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    const scoped = buildScopedCoverage({ research });
    const requests = buildScopedAssessmentRequests({
      research,
      coverage: { scoped },
      identityFingerprint: buildIdentityFingerprint(romance),
    });
    const a = buildScopedAssessmentInputFingerprint(requests);
    const b = buildScopedAssessmentInputFingerprint([...requests].reverse());
    assert.equal(a, b);
  });

  it("reanalyze-style reuse backfills missing 6A and reports changed only then", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["re"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    const reusedAnalysis = analysisShell();
    delete reusedAnalysis.meta.scopedAssessments;
    let calls = 0;
    const first = await finalizeScopedAssessments({
      research,
      analysis: reusedAnalysis,
      deps: {
        callScopedAssessmentModel: async ({ requests }) => {
          calls += 1;
          return {
            ok: true,
            invoked: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 5,
              outputTokens: 3,
              estimatedCostUsd: 0.0002,
            },
            modelOutput: {
              assessments: requests.map((r) => ({
                requestId: r.requestId,
                score: 4,
                confidence: "medium",
                basis: "source_consensus",
                reason: "backfill",
                evidenceRecordIds: r.allowedRecordIds,
              })),
            },
          };
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(first.changed, true);
    assert.ok(first.analysis.meta.scopedAssessments);

    const second = await finalizeScopedAssessments({
      research,
      analysis: first.analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          calls += 1;
          throw new Error("should reuse");
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(second.changed, false);
    assert.equal(second.reused, true);
    assert.equal(second.modelCalls, 0);
  });

  it("does not invent pairing Spice and keeps global assessments as sole global owner", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["spice"])[0],
      fields: [PROTECTIVE],
    });
    const analysis = analysisShell({
      meta: {
        assessments: {
          ...assessmentsAll({ score: 5 }),
          [SPICE]: assessment({ score: 5 }),
        },
      },
    });
    const result = await finalizeScopedAssessments({
      research: researchWithRecords(romance, [record]),
      analysis,
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 3,
              confidence: "medium",
              basis: "mixed_sources",
              reason: "ok",
              evidenceRecordIds: r.allowedRecordIds.slice(0, 1),
            })),
          },
        }),
      },
    });
    const blob = result.analysis.meta.scopedAssessments;
    for (const pairing of blob.pairings) {
      assert.equal(pairing.assessments[SPICE], undefined);
    }
    assert.equal(result.analysis.meta.assessments[SPICE].score, 5);
    assert.equal(result.analysis.meta.assessments[PROTECTIVE].score, 5);
  });

  it("does not permanently reuse missing_api_key/error; retries succeed on identical input", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["retry"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    let mode = "missing_key";
    let calls = 0;
    const deps = {
      callScopedAssessmentModel: async ({ requests }) => {
        calls += 1;
        if (mode === "missing_key") {
          return {
            ok: false,
            error: "missing_api_key",
            invoked: false,
            usage: { model: null, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
            modelOutput: null,
          };
        }
        return {
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 9,
            outputTokens: 4,
            estimatedCostUsd: 0.0003,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 4,
              confidence: "medium",
              basis: "source_consensus",
              reason: "after key",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        };
      },
    };

    const first = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps,
    });
    assert.equal(first.analysis.meta.scopedAssessments.status, "error");
    assert.deepEqual(first.analysis.meta.scopedAssessments.reasons, [
      "missing_api_key",
    ]);
    assert.equal(first.modelCalls, 0);
    assert.equal(first.modelAttempted, true);
    assert.equal(first.analysis.meta.scopedAssessments.usage.model, null);
    assert.equal(first.analysis.meta.scopedAssessments.usage.inputTokens, 0);
    assert.equal(
      canReuseScopedAssessments(first.analysis.meta.scopedAssessments, {
        identityFingerprint:
          first.analysis.meta.scopedAssessments.identityFingerprint,
        inputFingerprint: first.analysis.meta.scopedAssessments.inputFingerprint,
      }),
      false
    );

    mode = "ok";
    const second = await finalizeScopedAssessments({
      research,
      analysis: first.analysis,
      deps,
    });
    assert.equal(calls, 2);
    assert.equal(second.reused, false);
    assert.equal(second.modelCalls, 1);
    assert.equal(second.analysis.meta.scopedAssessments.status, "ready");
    assert.equal(second.analysis.meta.scopedAssessments.usage.inputTokens, 9);
  });

  it("ready reuses with zero model calls; zero-evidence insufficient reuses with zero calls", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["ready-reuse"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    let calls = 0;
    const deps = {
      callScopedAssessmentModel: async ({ requests }) => {
        calls += 1;
        return {
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 2,
            outputTokens: 2,
            estimatedCostUsd: 0.0001,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 3,
              confidence: "medium",
              basis: "source_consensus",
              reason: "ready",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        };
      },
    };
    const readyFirst = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps,
    });
    assert.equal(readyFirst.analysis.meta.scopedAssessments.status, "ready");
    const readySecond = await finalizeScopedAssessments({
      research,
      analysis: readyFirst.analysis,
      deps,
    });
    assert.equal(calls, 1);
    assert.equal(readySecond.reused, true);
    assert.equal(readySecond.modelCalls, 0);

    const emptyResearch = researchWithRecords(romance, []);
    const emptyFirst = await finalizeScopedAssessments({
      research: emptyResearch,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async () => {
          calls += 1;
          throw new Error("no evidence path must not call");
        },
      },
    });
    assert.equal(
      emptyFirst.analysis.meta.scopedAssessments.status,
      "insufficient_scope"
    );
    assert.ok(
      emptyFirst.analysis.meta.scopedAssessments.reasons.includes(
        "no_eligible_evidence"
      )
    );
    assert.equal(emptyFirst.analysis.meta.scopedAssessments.usage.model, null);
    assert.equal(emptyFirst.modelCalls, 0);
    const emptySecond = await finalizeScopedAssessments({
      research: emptyResearch,
      analysis: emptyFirst.analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          calls += 1;
          throw new Error("must reuse zero-evidence");
        },
      },
    });
    assert.equal(emptySecond.reused, true);
    assert.equal(emptySecond.modelCalls, 0);
    assert.equal(calls, 1);
  });

  it("no_scored_assessments insufficient_scope is not permanently reused", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["noscore"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    let calls = 0;
    const first = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => {
          calls += 1;
          return {
            ok: true,
            invoked: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 1,
              outputTokens: 1,
              estimatedCostUsd: 0,
            },
            modelOutput: {
              assessments: requests.map((r) => ({
                requestId: r.requestId,
                score: null,
                confidence: "low",
                basis: "insufficient",
                reason: "thin",
                evidenceRecordIds: [],
              })),
            },
          };
        },
      },
    });
    assert.equal(
      first.analysis.meta.scopedAssessments.status,
      "insufficient_scope"
    );
    assert.ok(
      first.analysis.meta.scopedAssessments.reasons.includes(
        "no_scored_assessments"
      )
    );
    assert.equal(
      canReuseScopedAssessments(first.analysis.meta.scopedAssessments, {
        identityFingerprint:
          first.analysis.meta.scopedAssessments.identityFingerprint,
        inputFingerprint: first.analysis.meta.scopedAssessments.inputFingerprint,
      }),
      false
    );
    const second = await finalizeScopedAssessments({
      research,
      analysis: first.analysis,
      deps: {
        callScopedAssessmentModel: async ({ requests }) => {
          calls += 1;
          return {
            ok: true,
            invoked: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 2,
              outputTokens: 2,
              estimatedCostUsd: 0,
            },
            modelOutput: {
              assessments: requests.map((r) => ({
                requestId: r.requestId,
                score: 4,
                confidence: "medium",
                basis: "source_consensus",
                reason: "retry",
                evidenceRecordIds: r.allowedRecordIds,
              })),
            },
          };
        },
      },
    });
    assert.equal(calls, 2);
    assert.equal(second.reused, false);
    assert.equal(second.analysis.meta.scopedAssessments.status, "ready");
  });

  it("diagnostic-only scores stay insufficient; primary scored becomes ready", async () => {
    const romance = rotatingIdentity();
    const primaryA = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["primary-a"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/primary-a",
    });
    const primaryB = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["primary-b"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/primary-b",
    });
    const secondary = makeBoundRecord({
      romance,
      pairingIndex: 2,
      summary: protectiveSummaries(romance, 2, ["secondary-diag"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/secondary-diag",
    });
    const research = researchWithRecords(romance, [
      primaryA,
      primaryB,
      secondary,
    ]);

    const diagnosticOnly = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 3,
            outputTokens: 2,
            estimatedCostUsd: 0,
          },
          modelOutput: {
            assessments: requests.map((r) => {
              const isPrimary =
                r.subjectBucket === "pairings" && r.requirement === "required";
              if (isPrimary) {
                return {
                  requestId: r.requestId,
                  score: null,
                  confidence: "low",
                  basis: "insufficient",
                  reason: "primary thin",
                  evidenceRecordIds: [],
                };
              }
              return {
                requestId: r.requestId,
                score: 4,
                confidence: "medium",
                basis: "source_consensus",
                reason: "diagnostic only",
                evidenceRecordIds: r.allowedRecordIds,
              };
            }),
          },
        }),
      },
    });

    const diagBlob = diagnosticOnly.analysis.meta.scopedAssessments;
    assert.equal(diagBlob.status, "insufficient_scope");
    assert.ok(
      diagBlob.reasons.includes("no_scored_primary_pairing_assessments")
    );
    assert.equal(diagBlob.reasons.includes("no_scored_assessments"), false);
    assert.ok(diagBlob.observed.length >= 1);
    const scoredDiag = diagBlob.observed.some((subj) =>
      Object.values(subj.assessments || {}).some(
        (a) => a.status === "scored" && a.score != null
      )
    );
    assert.equal(scoredDiag, true);
    const scoredPrimary = diagBlob.pairings.some((subj) =>
      Object.values(subj.assessments || {}).some(
        (a) => a.status === "scored" && a.score != null
      )
    );
    assert.equal(scoredPrimary, false);
    assert.equal(
      canReuseScopedAssessments(diagBlob, {
        identityFingerprint: diagBlob.identityFingerprint,
        inputFingerprint: diagBlob.inputFingerprint,
      }),
      false
    );

    const primaryReady = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 4,
            outputTokens: 3,
            estimatedCostUsd: 0,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 5,
              confidence: "medium",
              basis: "source_consensus",
              reason: "primary scored",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        }),
      },
    });
    assert.equal(primaryReady.analysis.meta.scopedAssessments.status, "ready");
    assert.ok(
      primaryReady.analysis.meta.scopedAssessments.pairings.some((subj) =>
        Object.values(subj.assessments || {}).some(
          (a) => a.status === "scored" && a.score != null
        )
      )
    );
  });

  it("duplicate record ids fail closed independent of input order", async () => {
    const romance = rotatingIdentity();
    const unique = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["unique-ok"])[0],
      fields: [PROTECTIVE, BODYGUARD],
      url: "https://reviews.example.com/unique-ok",
    });
    const dupA = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["dup-a"])[0],
      fields: [PROTECTIVE],
      url: "https://reviews.example.com/dup-a",
    });
    const dupB = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["dup-b-conflict"])[0],
      fields: [PROTECTIVE, BODYGUARD],
      url: "https://reviews.example.com/dup-b",
    });
    const duplicateId = "scoped-record-duplicate-id";
    dupA.id = duplicateId;
    dupB.id = duplicateId;
    // Superficially identical duplicate pair (same id + same content clone).
    const identicalTwin = JSON.parse(JSON.stringify(dupA));

    const coverageHasDupId = (research) => {
      const scoped = buildScopedCoverage({ research });
      return (scoped.cells || []).some((cell) =>
        (cell.recordIds || []).includes(duplicateId)
      );
    };

    async function runOrder(records) {
      const research = researchWithRecords(romance, records);
      assert.equal(coverageHasDupId(research), true);
      const recordById = buildScopedAssessmentRecordIndex(research);
      assert.equal(recordById.has(duplicateId), false);
      assert.equal(recordById.has(unique.id), true);
      const scoped = buildScopedCoverage({ research });
      const fingerprint = buildIdentityFingerprint(romance);
      const requests = buildScopedAssessmentRequests({
        research,
        coverage: { scoped },
        identityFingerprint: fingerprint,
        recordById,
      });
      for (const req of requests) {
        assert.equal((req.allowedRecordIds || []).includes(duplicateId), false);
        assert.equal(
          (req.sourceSummaries || []).some((s) => s.recordId === duplicateId),
          false
        );
      }
      const inputFingerprint = buildScopedAssessmentInputFingerprint(requests);
      const result = await finalizeScopedAssessments({
        research,
        analysis: analysisShell(),
        deps: {
          callScopedAssessmentModel: async ({ requests: reqs }) => ({
            ok: true,
            invoked: true,
            usage: {
              model: "gpt-4o-mini",
              inputTokens: 2,
              outputTokens: 2,
              estimatedCostUsd: 0,
            },
            modelOutput: {
              assessments: reqs.map((r) => ({
                requestId: r.requestId,
                score: r.allowedRecordIds.includes(unique.id) ? 4 : null,
                confidence: "medium",
                basis: r.allowedRecordIds.includes(unique.id)
                  ? "source_consensus"
                  : "insufficient",
                reason: "dup-order",
                evidenceRecordIds: r.allowedRecordIds.includes(unique.id)
                  ? [unique.id]
                  : [],
              })),
            },
          }),
        },
      });
      return {
        requests,
        inputFingerprint,
        blob: result.analysis.meta.scopedAssessments,
      };
    }

    const forward = await runOrder([unique, dupA, dupB]);
    const reversed = await runOrder([dupB, dupA, unique]);
    const identicalForward = await runOrder([unique, dupA, identicalTwin]);
    const identicalReversed = await runOrder([identicalTwin, dupA, unique]);

    assert.deepEqual(forward.requests, reversed.requests);
    assert.equal(forward.inputFingerprint, reversed.inputFingerprint);
    assert.deepEqual(forward.blob, reversed.blob);
    assert.deepEqual(identicalForward.requests, identicalReversed.requests);
    assert.equal(
      identicalForward.inputFingerprint,
      identicalReversed.inputFingerprint
    );
    assert.deepEqual(identicalForward.blob, identicalReversed.blob);

    const allBlobs = [
      forward.blob,
      reversed.blob,
      identicalForward.blob,
      identicalReversed.blob,
    ];
    for (const blob of allBlobs) {
      const json = JSON.stringify(blob);
      assert.equal(json.includes(duplicateId), false);
      assert.ok(
        blob.pairings.some((subj) =>
          Object.values(subj.assessments || {}).some((a) =>
            (a.evidenceRecordIds || []).includes(unique.id)
          )
        )
      );
    }
  });

  it("inactive removal clears scoped usage from meta and pipeline _usage", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["clear"])[0],
      fields: [PROTECTIVE],
    });
    const active = await finalizeScopedAssessments({
      research: researchWithRecords(romance, [record]),
      analysis: analysisShell({
        meta: {
          assessments: assessmentsAll(),
          inputTokens: 100,
          outputTokens: 40,
          estimatedCostUsd: 0.01,
          foundation: { locked: true, note: "keep-me" },
          customMarker: "preserve",
        },
      }),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          invoked: true,
          usage: {
            model: "gpt-4o-mini",
            inputTokens: 20,
            outputTokens: 8,
            estimatedCostUsd: 0.002,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 4,
              confidence: "medium",
              basis: "source_consensus",
              reason: "clear",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        }),
      },
    });
    assert.equal(active.analysis.meta.inputTokens, 120);
    assert.equal(active.analysis.meta.outputTokens, 48);
    assert.equal(active.analysis.meta.estimatedCostUsd, 0.012);
    assert.equal(active.analysis.meta.scopedAssessmentInputTokens, 20);
    const rowBefore = { ...active.analysis.row };
    const assessmentsBefore = JSON.stringify(active.analysis.meta.assessments);

    const staleUsage = mergeScopedUsageIntoPipelineUsage(
      {
        researchCacheHit: true,
        webSearchCalls: 3,
        scopedAssessmentTokens: { in: 99, out: 99 },
        scopedAssessmentEstimatedCostUsd: 9.9,
      },
      active.analysis.meta
    );
    assert.deepEqual(staleUsage.scopedAssessmentTokens, { in: 20, out: 8 });

    const single = singleCoupleIdentity();
    const inactive = await finalizeScopedAssessments({
      research: researchWithRecords(single, [
        makeBoundRecord({
          romance: single,
          pairingIndex: 0,
          summary: protectiveSummaries(single, 0, ["s"])[0],
          fields: [PROTECTIVE],
        }),
      ]),
      analysis: active.analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          throw new Error("inactive must not call");
        },
      },
    });
    assert.equal(inactive.inactive, true);
    assert.equal(inactive.changed, true);
    assert.equal(inactive.analysis.meta.scopedAssessments, undefined);
    assert.equal(inactive.analysis.meta.seriesAggregation, undefined);
    assert.equal(inactive.analysis.meta.scopedAssessmentInputTokens, undefined);
    assert.equal(inactive.analysis.meta.scopedAssessmentOutputTokens, undefined);
    assert.equal(
      inactive.analysis.meta.scopedAssessmentEstimatedCostUsd,
      undefined
    );
    assert.equal(inactive.analysis.meta.inputTokens, 100);
    assert.equal(inactive.analysis.meta.outputTokens, 40);
    assert.equal(inactive.analysis.meta.estimatedCostUsd, 0.01);
    assert.equal(inactive.analysis.meta.customMarker, "preserve");
    assert.deepEqual(inactive.analysis.meta.foundation, {
      locked: true,
      note: "keep-me",
    });
    assert.equal(JSON.stringify(inactive.analysis.meta.assessments), assessmentsBefore);
    assert.equal(inactive.analysis.row["Tine-score"], rowBefore["Tine-score"]);
    assert.equal(inactive.analysis.row["Tines score"], rowBefore["Tines score"]);
    assert.equal(
      inactive.analysis.row["Tines egen vurdering"],
      rowBefore["Tines egen vurdering"]
    );

    const clearedUsage = mergeScopedUsageIntoPipelineUsage(
      {
        researchCacheHit: true,
        webSearchCalls: 3,
        scopedAssessmentTokens: { in: 20, out: 8 },
        scopedAssessmentEstimatedCostUsd: 0.002,
      },
      inactive.analysis.meta
    );
    assert.equal(clearedUsage.scopedAssessmentTokens, undefined);
    assert.equal(clearedUsage.scopedAssessmentEstimatedCostUsd, undefined);
    assert.equal(clearedUsage.webSearchCalls, 3);

    const helperMeta = {
      inputTokens: 50,
      outputTokens: 10,
      estimatedCostUsd: 0.005,
      scopedAssessmentInputTokens: 5,
      scopedAssessmentOutputTokens: 2,
      scopedAssessmentEstimatedCostUsd: 0.001,
      scopedAssessments: { status: "ready" },
      keep: true,
    };
    clearScopedAssessmentArtifacts(helperMeta);
    assert.equal(helperMeta.scopedAssessments, undefined);
    assert.equal(helperMeta.inputTokens, 45);
    assert.equal(helperMeta.outputTokens, 8);
    assert.equal(helperMeta.estimatedCostUsd, 0.004);
    assert.equal(helperMeta.keep, true);
  });

  it("pipeline reused-analysis seam backfills missing 6A and skips write when fresh", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["seam"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    research.meta.webSearchCalls = 7;

    const existingBase = {
      "Seriens navn": "Alpha Cycle",
      "Tine-score": 80,
      Indholdsmatch: 80,
      "Læseprioritet nu": 70,
      "Tines score": 91,
      "Tines egen vurdering": "Elsker den",
      _research: research,
      _analysisMeta: {
        promptVersion: ANALYSIS_PROMPT_VERSION,
        assessments: assessmentsAll(),
        inputTokens: 100,
        outputTokens: 40,
        estimatedCostUsd: 0.01,
        analysisHash: "hash-seam",
      },
      _usage: {
        researchCacheHit: true,
        webSearchCalls: 0,
        scopedAssessmentTokens: { in: 1, out: 1 },
        scopedAssessmentEstimatedCostUsd: 0.0001,
      },
      _identity: research.identity,
    };

    let upsertCount = 0;
    let loadCount = 0;
    let modelCalls = 0;
    const upserted = [];

    const missing = await finalizeScopedOnReusedAnalysis({
      existing: existingBase,
      research,
      identity: research.identity,
      deps: {
        upsertSeries: (row) => {
          upsertCount += 1;
          upserted.push(row);
          return [row];
        },
        loadSeries: () => {
          loadCount += 1;
          return [existingBase];
        },
        scopedAssessmentDeps: {
          callScopedAssessmentModel: async ({ requests }) => {
            modelCalls += 1;
            return {
              ok: true,
              invoked: true,
              usage: {
                model: "gpt-4o-mini",
                inputTokens: 6,
                outputTokens: 3,
                estimatedCostUsd: 0.0004,
              },
              modelOutput: {
                assessments: requests.map((r) => ({
                  requestId: r.requestId,
                  score: 4,
                  confidence: "medium",
                  basis: "source_consensus",
                  reason: "seam",
                  evidenceRecordIds: r.allowedRecordIds,
                })),
              },
            };
          },
        },
      },
    });

    assert.equal(missing.meta.reused, true);
    assert.equal(missing.meta.scopedAssessmentsUpdated, true);
    assert.equal(missing.meta.webSearchUsed, false);
    assert.equal(missing.meta.researchCacheHit, true);
    assert.equal(upsertCount, 1);
    assert.equal(loadCount, 0);
    assert.equal(modelCalls, 1);
    assert.ok(upserted[0]._analysisMeta.scopedAssessments);
    assert.equal(upserted[0]._analysisMeta.scopedAssessments.status, "ready");
    assert.equal(upserted[0]._usage.webSearchCalls, 0);
    assert.deepEqual(upserted[0]._usage.scopedAssessmentTokens, {
      in: 6,
      out: 3,
    });
    assert.equal(research.meta.webSearchCalls, 7);

    const freshExisting = {
      ...upserted[0],
      _usage: { ...upserted[0]._usage },
    };
    const fresh = await finalizeScopedOnReusedAnalysis({
      existing: freshExisting,
      research,
      identity: research.identity,
      deps: {
        upsertSeries: () => {
          upsertCount += 1;
          throw new Error("fresh 6A must not write");
        },
        loadSeries: () => {
          loadCount += 1;
          return [freshExisting];
        },
        scopedAssessmentDeps: {
          callScopedAssessmentModel: async () => {
            modelCalls += 1;
            throw new Error("fresh 6A must not call model");
          },
        },
      },
    });
    assert.equal(fresh.meta.reused, true);
    assert.equal(fresh.meta.scopedAssessmentsUpdated, undefined);
    assert.match(fresh.meta.userMessage, /eksisterende analyse genbrugt/);
    assert.equal(fresh.meta.webSearchUsed, false);
    assert.equal(upsertCount, 1);
    assert.equal(loadCount, 1);
    assert.equal(modelCalls, 1);
    assert.equal(fresh.row, freshExisting);
    assert.equal(fresh.scopedFinal.reused, true);
    assert.equal(fresh.scopedFinal.modelCalls, 0);
  });

  it("analyze/refresh style totals include scoped cost once; empty usage model is null", async () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: protectiveSummaries(romance, 0, ["cost"])[0],
      fields: [PROTECTIVE],
    });
    const research = researchWithRecords(romance, [record]);
    research.meta.estimatedCostUsd = 0.05;
    research.meta.webSearchCalls = 4;
    const result = await finalizeScopedAssessments({
      research,
      analysis: analysisShell(),
      deps: {
        callScopedAssessmentModel: async ({ requests }) => ({
          ok: true,
          invoked: true,
          usage: {
            model: ANALYSIS_MODEL,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0.003,
          },
          modelOutput: {
            assessments: requests.map((r) => ({
              requestId: r.requestId,
              score: 4,
              confidence: "medium",
              basis: "source_consensus",
              reason: "cost",
              evidenceRecordIds: r.allowedRecordIds,
            })),
          },
        }),
      },
    });
    // Scoped cost folded into meta totals exactly once (not stacked again).
    assert.ok(
      Math.abs(result.analysis.meta.estimatedCostUsd - 0.013) < 1e-12
    );
    assert.equal(result.analysis.meta.scopedAssessmentEstimatedCostUsd, 0.003);
    const pipelineUsage = mergeScopedUsageIntoPipelineUsage(
      {
        researchCacheHit: false,
        webSearchCalls: research.meta.webSearchCalls,
        estimatedCostUsd:
          (research.meta.estimatedCostUsd || 0) +
          (result.analysis.meta.estimatedCostUsd || 0),
      },
      result.analysis.meta
    );
    assert.ok(Math.abs(pipelineUsage.estimatedCostUsd - 0.063) < 1e-12);
    assert.equal(pipelineUsage.scopedAssessmentEstimatedCostUsd, 0.003);
    assert.equal(pipelineUsage.webSearchCalls, 4);

    const empty = await finalizeScopedAssessments({
      research: researchWithRecords(romance, []),
      analysis: analysisShell(),
    });
    assert.equal(empty.analysis.meta.scopedAssessments.usage.model, null);
    assert.notEqual(
      empty.analysis.meta.scopedAssessments.usage.model,
      ANALYSIS_MODEL
    );
  });
});

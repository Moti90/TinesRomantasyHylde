import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import { calculateResearchCoverage } from "../server/services/adaptiveResearch.js";
import {
  ADAPTIVE_VERSION,
  ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE,
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
import {
  buildScopedCoverage,
  buildScopedCellKey,
  pickScopedEvidenceWinner,
  scopedEvidenceStrengthPoints,
  scopedSpecificityPoints,
  scopedStopQualitySatisfied,
} from "../server/services/seriesRomanceScopedCoverage.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";

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
    url: "https://reviews.example.com/scoped-cov",
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

function requiredCells(scoped) {
  return (scoped?.cells || []).filter((c) => c.requirement === "required");
}

function requiredForPair(scoped, romance, pairingIndex, field) {
  const key = pairingKey(romance, pairingIndex);
  return requiredCells(scoped).find(
    (c) => c.field === field && c.semanticPairingKey === key
  );
}

describe("seriesRomanceScopedCoverage activation", () => {
  it("planning-ready rotating with zero records still materializes required cells at 0", () => {
    const romance = rotatingIdentity();
    const scoped = buildScopedCoverage({
      research: { scopedRetrieval: { records: [] }, seriesRomanceIdentity: romance },
      seriesRomanceIdentity: romance,
    });
    assert.ok(scoped);
    assert.equal(scoped.active, true);
    assert.equal(scoped.version, SCOPED_COVERAGE_VERSION);
    assert.equal(
      requiredCells(scoped).length,
      2 * ROMANCE_SCOPE_ELIGIBLE_FIELDS.length
    );
    assert.ok(requiredCells(scoped).every((c) => c.coverageScore === 0));
    assert.equal(scoped.summary.allRequiredCellsCovered, false);
    assert.equal(scoped.summary.coveredCellCount, 0);
  });

  it("single_couple does not attach coverage.scoped", () => {
    const romance = singleCoupleIdentity();
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(),
      research: {
        sources: [],
        seriesRomanceIdentity: romance,
        seriesIdentity: { mmc: ALFA, fmc: BETA, resolution: { resolved: true } },
      },
      identity: { title: "Cycle Alpha" },
    });
    assert.equal(coverage.scoped, undefined);
    assert.equal(coverage.adaptiveVersion, ADAPTIVE_VERSION);
  });

  it("unresolved/not-ready does not attach coverage.scoped", () => {
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(),
      research: {
        sources: [],
        seriesRomanceIdentity: {
          topology: "unknown",
          pairings: [],
          resolution: { resolved: false },
        },
      },
      identity: { title: "Cycle Alpha" },
    });
    assert.equal(coverage.scoped, undefined);
  });
});

describe("seriesRomanceScopedCoverage isolation", () => {
  it("pair A covered evidence does not lift pair B", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: `${ALFA} and ${BETA} are a romantic pairing. ${ALFA} repeatedly protects ${BETA} and steps between her and danger.`,
      url: "https://reviews.example.com/pair-a-protect",
    });
    assert.equal(record.subjectBinding.status, "resolved");

    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });

    const a = requiredForPair(scoped, romance, 0, PROTECTIVE);
    const b = requiredForPair(scoped, romance, 1, PROTECTIVE);
    assert.ok(a);
    assert.ok(b);
    assert.ok(a.coverageScore > 0);
    assert.equal(b.coverageScore, 0);
    assert.equal(b.directEvidenceCount, 0);
    assert.equal(b.sourceIdentityKeys.length, 0);
  });

  it("no cross-pair leakage via global assessments", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} is fiercely protective of ${BETA}.`,
      url: "https://reviews.example.com/no-assess-leak",
    });
    const assessments = assessmentsAll({
      score: 5,
      confidence: "high",
      basis: "source_consensus",
      evidenceSourceIds: ["source-999"],
      sourceCount: 9,
    });
    const coverage = calculateResearchCoverage({
      assessments,
      research: {
        sources: [],
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      identity: { title: "Cycle Alpha" },
    });
    const b = requiredForPair(coverage.scoped, romance, 1, PROTECTIVE);
    assert.equal(b.coverageScore, 0);
    // Pair A score must not equal a global-assessment-inflated path.
    const a = requiredForPair(coverage.scoped, romance, 0, PROTECTIVE);
    assert.ok(a.coverageScore < 100 || a.directEvidenceCount >= 1);
  });

  it("different_scope evidence counts only in detected pairing", () => {
    const romance = rotatingIdentity();
    // Request pair A job, but content is about pair B.
    const record = makeBoundRecord({
      romance,
      pairingIndex: 0,
      summary: `${GAMMA} and ${DELTA} are a romantic pairing. ${GAMMA} protects ${DELTA} from danger.`,
      url: "https://reviews.example.com/diff-scope",
    });
    const pairingBind = record.subjectBinding.bindings.find(
      (b) => b.subjectType === "pairing"
    );
    assert.ok(pairingBind);
    assert.equal(pairingBind.relationshipRole, "another_primary_pairing");
    assert.equal(pairingBind.relationToRequest, "different_scope");

    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const a = requiredForPair(scoped, romance, 0, PROTECTIVE);
    const b = requiredForPair(scoped, romance, 1, PROTECTIVE);
    assert.equal(a.coverageScore, 0);
    assert.ok(b.coverageScore > 0);
  });
});

describe("seriesRomanceScopedCoverage eligibility", () => {
  it("excludes mixed/ambiguous/unresolved/invalid/stale bindings", () => {
    const romance = rotatingIdentity();
    const base = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/elig-base",
    });

    const statuses = [
      "mixed",
      "ambiguous",
      "unresolved",
      "invalid_identity",
      "invalid_record",
    ];
    for (const status of statuses) {
      const copy = structuredClone(base);
      copy.subjectBinding.status = status;
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      const a = requiredForPair(scoped, romance, 0, PROTECTIVE);
      assert.equal(a.coverageScore, 0, status);
    }

    const staleVersion = structuredClone(base);
    staleVersion.subjectBinding.version = "subject-binding-v0";
    const staleFp = structuredClone(base);
    staleFp.subjectBinding.identityFingerprint = "deadbeefdeadbeefdeadbeef";
    for (const copy of [staleVersion, staleFp]) {
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      assert.equal(
        requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
        0
      );
    }
  });

  it("member mmc slot may contribute to parent required cell; fmc does not for MMC fields", () => {
    const romance = rotatingIdentity();
    const mmcRecord = makeBoundRecord({
      romance,
      summary: `${ALFA} repeatedly protects the heroine and acts as her bodyguard.`,
      url: "https://reviews.example.com/mmc-member",
    });
    // Force member-only binding for Alfa.
    const pairKey = pairingKey(romance, 0);
    mmcRecord.subjectBinding = {
      version: SUBJECT_BINDING_VERSION,
      identityFingerprint: buildIdentityFingerprint(romance),
      status: "resolved",
      bindings: [
        {
          id: "scoped-binding-test-mmc",
          subjectType: "member",
          relationshipRole: "requested_pairing",
          relationToRequest: "partial_match",
          semanticPairingKey: pairKey,
          pairingId: "pair-ab",
          members: [{ name: ALFA, slot: "mmc" }],
          bookScopes: [],
          arcScopes: [],
          confidence: "high",
          signals: ["explicit_member_name"],
          reasons: ["partial_member_mention"],
        },
      ],
    };

    const scopedMmc = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [mmcRecord] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.ok(
      requiredForPair(scopedMmc, romance, 0, PROTECTIVE).coverageScore > 0
    );
    assert.ok(
      scopedMmc.cells.some(
        (c) => c.requirement === "observed" && c.subjectType === "member"
      )
    );

    const fmcRecord = structuredClone(mmcRecord);
    fmcRecord.source.url = "https://reviews.example.com/fmc-member";
    fmcRecord.sourceIdentity.identityKey = fmcRecord.source.url;
    fmcRecord.subjectBinding.bindings[0].members = [
      { name: BETA, slot: "fmc" },
    ];
    fmcRecord.source.summary = `${BETA} grows into her power across the arc.`;
    const scopedFmc = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [fmcRecord] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.equal(
      requiredForPair(scopedFmc, romance, 0, PROTECTIVE).coverageScore,
      0
    );
  });

  it("ignores malformed targetFields without throw or coverage", () => {
    const romance = rotatingIdentity();
    const base = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/mal-fields",
    });
    for (const bad of [null, undefined, "protective", { field: PROTECTIVE }]) {
      const copy = structuredClone(base);
      copy.targetFields = bad;
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      assert.equal(
        requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
        0
      );
    }
  });

  it("ignores malformed bindings without throw or coverage", () => {
    const romance = rotatingIdentity();
    const base = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/mal-bindings",
    });
    for (const bad of [null, undefined, "pairing", { id: "x" }]) {
      const copy = structuredClone(base);
      copy.subjectBinding.bindings = bad;
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      assert.equal(
        requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
        0
      );
    }
  });

  it("ignores missing sourceIdentity.identityKey without URL fallback", () => {
    const romance = rotatingIdentity();
    const base = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/mal-identity",
    });
    for (const bad of [
      { ...base.sourceIdentity, identityKey: "" },
      { ...base.sourceIdentity, identityKey: "   " },
      { ...base.sourceIdentity, identityKey: null },
      { scheme: "url", identityKey: undefined },
      null,
      undefined,
    ]) {
      const copy = structuredClone(base);
      copy.sourceIdentity = bad;
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      assert.equal(
        requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
        0
      );
    }
  });

  it("ignores malformed source without throw or coverage", () => {
    const romance = rotatingIdentity();
    const base = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/mal-source",
    });
    for (const bad of [null, undefined, "blog", 42]) {
      const copy = structuredClone(base);
      copy.source = bad;
      const scoped = buildScopedCoverage({
        research: {
          scopedRetrieval: { records: [copy] },
          seriesRomanceIdentity: romance,
        },
        seriesRomanceIdentity: romance,
      });
      assert.equal(
        requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
        0
      );
    }
  });
});

describe("seriesRomanceScopedCoverage observed subjects", () => {
  function forceBindingRecord({ romance, summary, url, bindings }) {
    const record = makeBoundRecord({ romance, summary, url });
    record.subjectBinding = {
      version: SUBJECT_BINDING_VERSION,
      identityFingerprint: buildIdentityFingerprint(romance),
      status: "resolved",
      bindings,
    };
    return record;
  }

  it("ALT observed cell exists and leaves primary required at 0", () => {
    const romance = rotatingIdentity();
    const pairKey = pairingKey(romance, 0);
    const record = forceBindingRecord({
      romance,
      summary: `${EPSILON} is protective in battle as an early love interest.`,
      url: "https://reviews.example.com/altli-strict",
      bindings: [
        {
          id: "scoped-binding-altli",
          subjectType: "member",
          relationshipRole: "alternative_love_interest",
          relationToRequest: "different_scope",
          semanticPairingKey: pairKey,
          pairingId: "pair-ab",
          members: [{ name: EPSILON, slot: null }],
          bookScopes: [],
          arcScopes: [],
          confidence: "high",
          signals: ["alternative_love_interest"],
          reasons: ["alternative_love_interest"],
        },
      ],
    });
    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.ok(
      scoped.cells.some(
        (c) =>
          c.requirement === "observed" &&
          c.subjectType === "member" &&
          c.relationshipRole === "alternative_love_interest" &&
          c.coverageScore > 0
      )
    );
    assert.equal(
      requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
      0
    );
  });

  it("secondary pairing observed cell exists and leaves primary required at 0", () => {
    const romance = rotatingIdentity();
    const secKey = pairingKey(romance, 2);
    const record = forceBindingRecord({
      romance,
      summary: `Zeta and Eta are a romantic pairing. Eta protects Zeta from danger.`,
      url: "https://reviews.example.com/sec-pairing-strict",
      bindings: [
        {
          id: "scoped-binding-sec-pair",
          subjectType: "pairing",
          relationshipRole: "secondary_pairing",
          relationToRequest: "different_scope",
          semanticPairingKey: secKey,
          pairingId: "pair-sec",
          members: [
            { name: "Eta", slot: "mmc" },
            { name: "Zeta", slot: "fmc" },
          ],
          bookScopes: [{ bookNumber: 3, title: "Alpha Three" }],
          arcScopes: [],
          confidence: "high",
          signals: ["explicit_pairing"],
          reasons: ["secondary_pairing"],
        },
      ],
    });
    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.ok(
      scoped.cells.some(
        (c) =>
          c.requirement === "observed" &&
          c.subjectType === "pairing" &&
          c.relationshipRole === "secondary_pairing" &&
          c.semanticPairingKey === secKey &&
          c.coverageScore > 0
      )
    );
    assert.equal(
      requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
      0
    );
    assert.equal(
      requiredForPair(scoped, romance, 1, PROTECTIVE).coverageScore,
      0
    );
  });

  it("secondary member observed cell exists and leaves primary required at 0", () => {
    const romance = rotatingIdentity();
    const secKey = pairingKey(romance, 2);
    const record = forceBindingRecord({
      romance,
      summary: `Eta repeatedly protects the heroine and acts as her bodyguard.`,
      url: "https://reviews.example.com/sec-member-strict",
      bindings: [
        {
          id: "scoped-binding-sec-member",
          subjectType: "member",
          relationshipRole: "secondary_pairing",
          relationToRequest: "different_scope",
          semanticPairingKey: secKey,
          pairingId: "pair-sec",
          members: [{ name: "Eta", slot: "mmc" }],
          bookScopes: [],
          arcScopes: [],
          confidence: "high",
          signals: ["explicit_member_name"],
          reasons: ["secondary_member"],
        },
      ],
    });
    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.ok(
      scoped.cells.some(
        (c) =>
          c.requirement === "observed" &&
          c.subjectType === "member" &&
          c.semanticPairingKey === secKey &&
          c.member?.name === "Eta" &&
          c.coverageScore > 0
      )
    );
    assert.equal(
      requiredForPair(scoped, romance, 0, PROTECTIVE).coverageScore,
      0
    );
    assert.equal(
      requiredForPair(scoped, romance, 1, PROTECTIVE).coverageScore,
      0
    );
  });
});

describe("seriesRomanceScopedCoverage formula and dedup", () => {
  it("strength / specificity / stop-quality thresholds", () => {
    assert.equal(scopedEvidenceStrengthPoints(1, 0), 20);
    assert.equal(scopedEvidenceStrengthPoints(0, 1), 9);
    assert.equal(scopedEvidenceStrengthPoints(0, 0), 0);
    assert.equal(scopedSpecificityPoints(0), 0);
    assert.equal(scopedSpecificityPoints(1), 8);
    assert.equal(scopedSpecificityPoints(2), 15);
    assert.equal(
      scopedStopQualitySatisfied({
        directSources: [{ url: "https://a.example" }],
        supportingSources: [],
      }),
      true
    );
    assert.equal(
      scopedStopQualitySatisfied({
        directSources: [],
        supportingSources: [
          { url: "https://a.example", type: "blog" },
          { url: "https://b.example", type: "blog" },
        ],
      }),
      true
    );
  });

  it("dedups same identity across jobs/rounds/fallback into one cell count", () => {
    const romance = rotatingIdentity();
    const summary = `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA} as a bodyguard.`;
    const url = "https://reviews.example.com/same-identity";
    const primary = makeBoundRecord({
      romance,
      summary,
      url,
    });
    const fallback = makeBoundRecord({
      romance,
      summary,
      url,
    });
    fallback.retrievalStrategy = "broad_fallback";
    fallback.retrievalAttempt = 2;
    // Force distinct record ids but same source identity.
    fallback.id = primary.id.replace("scoped-retrieval-", "scoped-retrieval-x");
    fallback.sourceIdentity = { ...primary.sourceIdentity };

    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [primary, fallback] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const cell = requiredForPair(scoped, romance, 0, PROTECTIVE);
    assert.equal(cell.sourceIdentityKeys.length, 1);
    assert.ok(cell.directEvidenceCount + cell.supportingEvidenceCount === 1);
  });

  it("same identity prefers direct over supporting regardless of input order", () => {
    const romance = rotatingIdentity();
    const sharedKey = "identity:shared-direct-vs-supporting";
    const summary = `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA} and stands between her and danger.`;

    const directRec = makeBoundRecord({
      romance,
      summary,
      url: "https://reviews.example.com/direct-win-a",
    });
    directRec.source.type = "blog";
    directRec.sourceIdentity = {
      ...directRec.sourceIdentity,
      identityKey: sharedKey,
    };

    const supportingRec = makeBoundRecord({
      romance,
      summary,
      url: "https://en.wikipedia.org/wiki/Cycle_Alpha_protect",
    });
    supportingRec.source.type = "wikipedia";
    supportingRec.source.title = "Cycle Alpha";
    supportingRec.sourceIdentity = {
      ...supportingRec.sourceIdentity,
      identityKey: sharedKey,
    };
    supportingRec.id = directRec.id.replace(
      "scoped-retrieval-",
      "scoped-retrieval-wiki-"
    );

    const forward = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [supportingRec, directRec] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const reverse = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [directRec, supportingRec] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.deepEqual(forward, reverse);

    const cell = requiredForPair(forward, romance, 0, PROTECTIVE);
    assert.equal(cell.sourceIdentityKeys.length, 1);
    assert.equal(cell.sourceIdentityKeys[0], sharedKey);
    assert.equal(cell.directEvidenceCount, 1);
    assert.equal(cell.supportingEvidenceCount, 0);
    assert.deepEqual(cell.recordIds, [directRec.id].sort());
  });

  it("pickScopedEvidenceWinner is order-independent", () => {
    const direct = {
      identityKey: "k",
      bucket: "direct",
      role: "primary",
      recordId: "b-record",
      source: { url: "https://z.example/a", title: "Z", summary: "z" },
    };
    const supporting = {
      identityKey: "k",
      bucket: "supporting",
      role: "primary",
      recordId: "a-record",
      source: { url: "https://a.example/a", title: "A", summary: "a" },
    };
    assert.equal(pickScopedEvidenceWinner(direct, supporting), direct);
    assert.equal(pickScopedEvidenceWinner(supporting, direct), direct);

    const left = {
      identityKey: "k",
      bucket: "direct",
      role: "a",
      recordId: "r1",
      source: { url: "https://a.example", title: "A", summary: "s" },
    };
    const right = {
      identityKey: "k",
      bucket: "direct",
      role: "b",
      recordId: "r0",
      source: { url: "https://b.example", title: "B", summary: "t" },
    };
    assert.equal(pickScopedEvidenceWinner(left, right), left);
    assert.equal(pickScopedEvidenceWinner(right, left), left);
  });

  it("covered requires score >= critical min and stopQuality", () => {
    assert.equal(ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE, 60);
    const romance = rotatingIdentity();
    const records = [1, 2, 3].map((n) =>
      makeBoundRecord({
        romance,
        summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA} and stands between her and danger in scene ${n}.`,
        url: `https://reviews.example.com/cover-${n}`,
      })
    );
    const scoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const cell = requiredForPair(scoped, romance, 0, PROTECTIVE);
    assert.ok(cell.coverageScore >= 60);
    assert.equal(cell.stopQualitySatisfied, true);
    assert.equal(cell.covered, true);
  });

  it("cell keys ignore pairingId and array order", () => {
    const a = buildScopedCellKey({
      field: PROTECTIVE,
      subjectType: "pairing",
      semanticPairingKey: "alfa+beta|book:1",
      pairingId: "pair-a",
    });
    const b = buildScopedCellKey({
      field: PROTECTIVE,
      subjectType: "pairing",
      semanticPairingKey: "alfa+beta|book:1",
      pairingId: "renamed",
    });
    assert.equal(a, b);
  });

  it("deterministic cell ordering is stable", () => {
    const romance = rotatingIdentity();
    const record = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/order",
    });
    const research = {
      scopedRetrieval: { records: [record] },
      seriesRomanceIdentity: romance,
    };
    const first = buildScopedCoverage({ research, seriesRomanceIdentity: romance });
    const second = buildScopedCoverage({ research, seriesRomanceIdentity: romance });
    assert.deepEqual(
      first.cells.map((c) => c.key),
      second.cells.map((c) => c.key)
    );
  });
});

describe("seriesRomanceScopedCoverage determinism and legacy", () => {
  it("shuffled records yield deep-equal coverage.scoped", () => {
    const romance = rotatingIdentity();
    const records = [
      makeBoundRecord({
        romance,
        pairingIndex: 0,
        summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
        url: "https://reviews.example.com/shuf-a",
      }),
      makeBoundRecord({
        romance,
        pairingIndex: 1,
        summary: `${GAMMA} and ${DELTA} romantic pairing. ${GAMMA} protects ${DELTA}.`,
        url: "https://reviews.example.com/shuf-b",
      }),
      makeBoundRecord({
        romance,
        pairingIndex: 0,
        summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} is a fierce bodyguard for ${BETA}.`,
        url: "https://reviews.example.com/shuf-c",
      }),
    ];
    const forward = buildScopedCoverage({
      research: {
        scopedRetrieval: { records },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const reverse = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [...records].reverse() },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    assert.deepEqual(forward, reverse);
  });

  it("shuffled identity pairing/member/scope arrays keep cell keys and summary", () => {
    const romance = rotatingIdentity();
    const shuffled = structuredClone(romance);
    shuffled.pairings = [...shuffled.pairings].reverse();
    for (const pairing of shuffled.pairings) {
      pairing.members = [...(pairing.members || [])].reverse();
      pairing.bookScopes = [...(pairing.bookScopes || [])].reverse();
      pairing.arcScopes = [...(pairing.arcScopes || [])].reverse();
      if (Array.isArray(pairing.alternatives)) {
        pairing.alternatives = [...pairing.alternatives].reverse();
      }
    }

    const record = makeBoundRecord({
      romance,
      summary: `${ALFA} and ${BETA} romantic pairing. ${ALFA} protects ${BETA}.`,
      url: "https://reviews.example.com/shuf-identity",
    });
    // Rebind against shuffled identity fingerprint so eligibility matches.
    const rebound = bindScopedRetrievalRecord(
      {
        ...record,
        subjectBinding: undefined,
      },
      shuffled
    );

    const baseScoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [record] },
        seriesRomanceIdentity: romance,
      },
      seriesRomanceIdentity: romance,
    });
    const shuffledScoped = buildScopedCoverage({
      research: {
        scopedRetrieval: { records: [rebound] },
        seriesRomanceIdentity: shuffled,
      },
      seriesRomanceIdentity: shuffled,
    });
    assert.deepEqual(
      baseScoped.cells.map((c) => c.key),
      shuffledScoped.cells.map((c) => c.key)
    );
    assert.deepEqual(baseScoped.summary, shuffledScoped.summary);
  });

  it("single_couple with seriesRomanceIdentity matches legacy without scoped key", () => {
    const romance = singleCoupleIdentity();
    const assessments = assessmentsAll();
    const identity = { title: "Cycle Alpha" };
    const seriesIdentity = {
      mmc: ALFA,
      fmc: BETA,
      resolution: { resolved: true },
    };
    const withRomance = calculateResearchCoverage({
      assessments,
      research: {
        sources: [],
        seriesRomanceIdentity: romance,
        seriesIdentity,
      },
      identity,
    });
    const legacy = calculateResearchCoverage({
      assessments,
      research: {
        sources: [],
        seriesIdentity,
      },
      identity,
    });
    assert.equal(withRomance.scoped, undefined);
    assert.equal(legacy.scoped, undefined);
    assert.deepEqual(withRomance, legacy);
  });

  it("unresolved/not-ready remains without coverage.scoped", () => {
    const coverage = calculateResearchCoverage({
      assessments: assessmentsAll(),
      research: {
        sources: [],
        seriesRomanceIdentity: {
          topology: "unknown",
          pairings: [],
          resolution: { resolved: false },
        },
      },
      identity: { title: "Cycle Alpha" },
    });
    assert.equal(coverage.scoped, undefined);
  });
});

describe("Structure 5A versions", () => {
  it("ADAPTIVE_VERSION is adaptive-v14 and scoped-coverage-v1", () => {
    assert.equal(ADAPTIVE_VERSION, "adaptive-v14");
    assert.equal(SCOPED_COVERAGE_VERSION, "scoped-coverage-v1");
  });
});

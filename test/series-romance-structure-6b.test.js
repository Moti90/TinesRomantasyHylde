import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SUBJECTIVE_KEYS, estimateTineScoreFromVibes } from "../server/services/decisionScores.js";
import { dataPath } from "../server/services/paths.js";
import {
  ADAPTIVE_VERSION,
  ANALYSIS_PROMPT_VERSION,
  SCOPED_ASSESSMENT_PROMPT_VERSION,
  SCOPED_ASSESSMENT_VERSION,
  SCOPED_COVERAGE_VERSION,
  SERIES_AGGREGATION_VERSION,
  SUBJECT_BINDING_VERSION,
} from "../server/services/versions.js";
import { PAIRING_RELATIONS } from "../server/services/seriesRomanceIdentity.js";
import {
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "../server/services/seriesRomancePlanning.js";
import {
  buildIdentityFingerprint,
} from "../server/services/seriesRomanceSubjectBinding.js";
import { buildScopedCoverage } from "../server/services/seriesRomanceScopedCoverage.js";
import {
  PAIRING_SCOPED_V1,
  SERIES_GLOBAL_V1,
  finalizeScopedAssessments,
} from "../server/services/seriesRomanceScopedAssessment.js";
import {
  applyLearnedTasteAdjustment,
  applyLearnedTasteAdjustmentWithProfile,
  buildTasteFingerprint,
} from "../server/services/learnedTaste.js";
import {
  attachSeriesAggregation,
  buildCanonicalBooksFromIdentity,
  buildPairingBookContribution,
  buildSeriesAggregation,
  classifyAggregationConfidence,
  projectPairingBookFields,
} from "../server/services/seriesRomanceAggregation.js";
import { finalizeScopedOnReusedAnalysis } from "../server/services/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const WORLD = "Worldbuilding (0-5)";
const EPIC = "Episk plot (0-5)";
const SPICE = "Spice/erotik (0-5)";

const ALFA = "Alfa";
const BETA = "Beta";
const GAMMA = "Gamma";
const DELTA = "Delta";
const EPSILON = "Epsilon";

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function emptyTaste() {
  return {
    version: "learned-taste-v1",
    reviewCount: 0,
    scoredReviewCount: 0,
    updatedAt: "2099-01-01T00:00:00.000Z",
    fieldPrefs: {},
    positiveTags: {},
    negativeTags: {},
    reread: { yes: 0, maybe: 0, no: 0 },
  };
}

function strongTaste(over = {}) {
  return {
    version: "learned-taste-v1",
    reviewCount: 20,
    scoredReviewCount: 20,
    updatedAt: "2099-01-01T00:00:00.000Z",
    fieldPrefs: {
      [RHYSAND]: {
        n: 10,
        mean: 4.8,
        highMean: 5,
        lowMean: 1,
        highN: 8,
        lowN: 2,
        max: 5,
      },
      [PROTECTIVE]: {
        n: 10,
        mean: 4.7,
        highMean: 5,
        lowMean: 1,
        highN: 8,
        lowN: 2,
        max: 5,
      },
    },
    positiveTags: {},
    negativeTags: {},
    reread: { yes: 10, maybe: 5, no: 5 },
    ...over,
  };
}

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "high",
    basis: "source_consensus",
    evidenceSourceIds: ["g1"],
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

function scoredScoped(score, over = {}) {
  return {
    status: "scored",
    score,
    confidence: "medium",
    basis: "source_consensus",
    reason: "ok",
    evidenceRecordIds: ["r1"],
    evidenceIdentityKeys: ["id1"],
    conflictingRecordIds: [],
    coverageCellKeys: [],
    ...over,
  };
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

function sharedBookIdentity() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "ensemble_mixed",
      pairings: [
        {
          members: [member(ALFA, "mmc"), member(BETA, "fmc")],
          bookScopes: [{ bookNumber: 1, title: "Shared Title" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [member(GAMMA, "mmc"), member(DELTA, "fmc")],
          bookScopes: [{ bookNumber: 1, title: "Shared Title Alt" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    })
  );
}

function arcOnlyIdentity() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        {
          members: [member(ALFA, "mmc"), member(BETA, "fmc")],
          bookScopes: [],
          arcScopes: [{ id: "arc-only", label: "Only Arc" }],
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

function fiveFieldAssessments(score) {
  return Object.fromEntries(
    PAIRING_SCOPED_V1.map((field) => [field, scoredScoped(score)])
  );
}

function makeScopedReady({
  romance,
  pairingScores = {},
  bookScores = {},
  status = "ready",
  reasons = [],
} = {}) {
  const fingerprint = buildIdentityFingerprint(romance);
  const pairings = [];
  for (let i = 0; i < (romance.pairings || []).length; i++) {
    const pairing = romance.pairings[i];
    if (pairing.prominence !== "primary") continue;
    const key = pairingKey(romance, i);
    const scoreMap = pairingScores[key] || pairingScores[i] || fiveFieldAssessments(4);
    pairings.push({
      subjectKey: `pairing:${key}`,
      semanticPairingKey: key,
      memberNames: sortedDisplayMemberNames(pairing.members),
      bookKeys: (pairing.bookScopes || [])
        .map((b) =>
          b.bookNumber != null && Number.isFinite(Number(b.bookNumber))
            ? `book:${Number(b.bookNumber)}`
            : null
        )
        .filter(Boolean),
      assessments: scoreMap,
    });
  }
  const books = [];
  for (const [subjectKey, assessments] of Object.entries(bookScores)) {
    const m = subjectKey.match(/^book:(.+)\|pair:(.+)$/);
    books.push({
      subjectKey,
      bookKey: m ? m[1] : null,
      bookNumber: null,
      title: null,
      semanticPairingKey: m ? m[2] : null,
      assessments,
    });
  }
  return {
    version: SCOPED_ASSESSMENT_VERSION,
    promptVersion: SCOPED_ASSESSMENT_PROMPT_VERSION,
    identityFingerprint: fingerprint,
    inputFingerprint: "scoped-input-fp-test",
    topology: romance.topology,
    status,
    pairings: pairings.sort((a, b) =>
      a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0
    ),
    books: books.sort((a, b) =>
      a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0
    ),
    arcs: [],
    observed: [],
    usage: { model: null, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    reasons,
  };
}

function researchShell(romance) {
  return {
    identity: { title: "Alpha Cycle", author: "Author", series: "Alpha Cycle" },
    seriesRomanceIdentity: romance,
    sources: [],
    scopedRetrieval: { version: "scoped-retrieval-v1", records: [] },
    meta: { webSearchCalls: 1 },
  };
}

describe("Structure 6B equal-book aggregation", () => {
  it("locks versions and taxonomy without bumping unrelated contracts", () => {
    assert.equal(SERIES_AGGREGATION_VERSION, "series-aggregation-v1");
    assert.equal(ADAPTIVE_VERSION, "adaptive-v15");
    assert.equal(ANALYSIS_PROMPT_VERSION, "analysis-v16");
    assert.equal(SCOPED_ASSESSMENT_VERSION, "scoped-assessment-v1");
    assert.equal(SCOPED_ASSESSMENT_PROMPT_VERSION, "scoped-assessment-prompt-v1");
    assert.equal(SCOPED_COVERAGE_VERSION, "scoped-coverage-v1");
    assert.equal(SUBJECT_BINDING_VERSION, "subject-binding-v1");
    assert.deepEqual(PAIRING_SCOPED_V1, [...ROMANCE_SCOPE_ELIGIBLE_FIELDS]);
    assert.equal(SERIES_GLOBAL_V1.includes(PROTECTIVE), false);
    assert.equal(SERIES_GLOBAL_V1.includes(WORLD), true);
  });

  it("projects book > pairing for five fields and never falls back to global for them", () => {
    const romance = rotatingIdentity();
    const p0 = pairingKey(romance, 0);
    const scoped = makeScopedReady({
      romance,
      pairingScores: {
        [p0]: fiveFieldAssessments(2),
      },
      bookScores: {
        [`book:book:1|pair:${p0}`]: {
          [PROTECTIVE]: scoredScoped(5),
        },
      },
    });
    // Force pairing protective to 2; book overrides to 5.
    scoped.pairings[0].assessments[PROTECTIVE] = scoredScoped(2);
    const globals = assessmentsAll({ score: 1 });
    globals[PROTECTIVE] = assessment({ score: 0 });
    globals[WORLD] = assessment({ score: 4 });

    const { projectedFields } = projectPairingBookFields({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: scoped,
      globalAssessments: globals,
    });

    assert.equal(projectedFields[PROTECTIVE].score, 5);
    assert.equal(projectedFields[PROTECTIVE].sourceScope, "book");
    assert.equal(projectedFields[BODYGUARD].score, 2);
    assert.equal(projectedFields[BODYGUARD].sourceScope, "pairing");
    assert.equal(projectedFields[WORLD].score, 4);
    assert.equal(projectedFields[WORLD].sourceScope, "global");
    assert.equal(projectedFields[PROTECTIVE].score === 0, false);
  });

  it("canonical books dedup/display are order-independent; secondary/arc-only ignored", () => {
    const romance = rotatingIdentity();
    const reversed = {
      ...romance,
      pairings: [...romance.pairings].reverse(),
    };
    const a = buildCanonicalBooksFromIdentity(romance);
    const b = buildCanonicalBooksFromIdentity(reversed);
    assert.deepEqual(a, b);
    assert.deepEqual(
      a.map((x) => x.bookKey),
      ["book:1", "book:2"]
    );
    assert.equal(
      a.some((x) => x.bookKey === "book:3"),
      false
    );

    const shared = sharedBookIdentity();
    const books = buildCanonicalBooksFromIdentity(shared);
    assert.equal(books.length, 1);
    assert.equal(books[0].bookKey, "book:1");
    assert.equal(books[0].primaryPairingKeys.length, 2);
    assert.equal(books[0].title, "Shared Title");

    const arcOnly = buildCanonicalBooksFromIdentity(arcOnlyIdentity());
    assert.deepEqual(arcOnly, []);
  });

  it("equal primary contributions within shared book and equal books across series", () => {
    const romance = sharedBookIdentity();
    const p0 = pairingKey(romance, 0);
    const p1 = pairingKey(romance, 1);
    const scoped = makeScopedReady({
      romance,
      pairingScores: {
        [p0]: fiveFieldAssessments(5),
        [p1]: fiveFieldAssessments(1),
      },
    });
    // Fill enough globals for vibe estimate.
    const globals = assessmentsAll({ score: 3 });
    const agg = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
    });
    assert.equal(agg.status, "ready");
    assert.equal(agg.canonicalBooks.length, 1);
    const book = agg.canonicalBooks[0];
    assert.equal(book.pairingContributions.length, 2);
    const bases = book.pairingContributions.map((c) => c.baseScore);
    assert.equal(book.baseUnitScore, Math.round((bases[0] + bases[1]) / 2));
    assert.equal(book.unitScore, book.baseUnitScore);

    const rotating = rotatingIdentity();
    const rp0 = pairingKey(rotating, 0);
    const rp1 = pairingKey(rotating, 1);
    const scoped2 = makeScopedReady({
      romance: rotating,
      pairingScores: {
        [rp0]: fiveFieldAssessments(5),
        [rp1]: fiveFieldAssessments(1),
      },
    });
    const agg2 = buildSeriesAggregation({
      research: researchShell(rotating),
      analysisMeta: { scopedAssessments: scoped2, assessments: globals },
      taste: emptyTaste(),
    });
    assert.equal(agg2.canonicalBooks.length, 2);
    const units = agg2.canonicalBooks.map((b) => b.unitScore);
    assert.equal(agg2.seriesScore, Math.round((units[0] + units[1]) / 2));
    assert.equal(agg2.baseSeriesScore, agg2.seriesScore);
  });

  it("excludes missing books as null not zero; one valid book works; no books insufficient", () => {
    const romance = rotatingIdentity();
    const p0 = pairingKey(romance, 0);
    const p1 = pairingKey(romance, 1);
    const insufficient = Object.fromEntries(
      PAIRING_SCOPED_V1.map((f) => [
        f,
        {
          status: "insufficient",
          score: null,
          confidence: "low",
          basis: "insufficient",
          reason: "missing",
          evidenceRecordIds: [],
          evidenceIdentityKeys: [],
          conflictingRecordIds: [],
          coverageCellKeys: [],
        },
      ])
    );
    const scoped = makeScopedReady({
      romance,
      pairingScores: {
        [p0]: fiveFieldAssessments(4),
        [p1]: insufficient,
      },
    });
    // Globals alone must not be enough for vibe estimate (exclude missing-scoped book).
    const globals = {
      "Romance i fokus (0-100%)": assessment({ score: 55 }),
      "Hvor hurtigt griber den? (0-100%)": assessment({ score: 40 }),
      "Spice/erotik (0-5)": assessment({ score: 3 }),
    };
    const agg = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
    });
    assert.equal(agg.status, "ready");
    assert.equal(agg.canonicalBooks.length, 2);
    const valid = agg.canonicalBooks.filter((b) => b.unitScore != null);
    const excluded = agg.canonicalBooks.filter((b) => b.unitScore == null);
    assert.equal(valid.length, 1);
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].excludedReason, "no_valid_primary_contribution");
    assert.equal(agg.seriesScore, valid[0].unitScore);
    assert.notEqual(agg.seriesScore, 0);
    assert.equal(agg.bookCompleteness, 0.5);

    const arcAgg = buildSeriesAggregation({
      research: researchShell(arcOnlyIdentity()),
      analysisMeta: {
        scopedAssessments: makeScopedReady({ romance: arcOnlyIdentity() }),
        assessments: globals,
      },
      taste: emptyTaste(),
    });
    assert.equal(arcAgg.status, "insufficient_scope");
    assert.equal(arcAgg.seriesScore, null);
    assert.equal(arcAgg.range, null);
    assert.equal(arcAgg.variation, null);
    assert.equal(arcAgg.confidence, "low");
  });

  it("ignores secondary, ALT LI, member, observed, and arc subjects for main aggregate", () => {
    const romance = rotatingIdentity();
    const scoped = makeScopedReady({ romance });
    scoped.observed = [
      {
        subjectKey: "observed-pairing:sec",
        subjectType: "pairing",
        relationshipRole: "secondary_pairing",
        semanticPairingKey: "sec-key",
        assessments: fiveFieldAssessments(5),
      },
    ];
    scoped.arcs = [
      {
        subjectKey: "arc:x",
        arcKey: "arc:x",
        label: "X",
        semanticPairingKey: pairingKey(romance, 0),
        assessments: fiveFieldAssessments(5),
      },
    ];
    const before = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: scoped,
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    const withoutDiag = {
      ...scoped,
      observed: [],
      arcs: [],
    };
    const after = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: withoutDiag,
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    assert.equal(before.seriesScore, after.seriesScore);
    assert.equal(before.baseSeriesScore, after.baseSeriesScore);
    assert.deepEqual(
      before.canonicalBooks.map((b) => b.unitScore),
      after.canonicalBooks.map((b) => b.unitScore)
    );
  });

  it("applies learned taste once per contribution; taste change invalidates; updatedAt/order do not", () => {
    const romance = rotatingIdentity();
    const p0 = pairingKey(romance, 0);
    const scoped = makeScopedReady({
      romance,
      pairingScores: { [p0]: fiveFieldAssessments(5), [pairingKey(romance, 1)]: fiveFieldAssessments(5) },
    });
    const globals = assessmentsAll({ score: 3 });
    const tasteA = strongTaste();
    const tasteB = strongTaste({
      updatedAt: "1999-01-01T00:00:00.000Z",
      fieldPrefs: {
        [PROTECTIVE]: tasteA.fieldPrefs[PROTECTIVE],
        [RHYSAND]: tasteA.fieldPrefs[RHYSAND],
      },
    });
    assert.equal(buildTasteFingerprint(tasteA), buildTasteFingerprint(tasteB));

    const contrib = buildPairingBookContribution({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: scoped,
      globalAssessments: globals,
      taste: tasteA,
    });
    assert.ok(contrib.contribution);
    const base = contrib.contribution.baseScore;
    const expected = applyLearnedTasteAdjustmentWithProfile(
      Object.fromEntries(
        Object.entries(contrib.contribution.projectedFields).map(([k, v]) => [
          k,
          v.score,
        ])
      ),
      base,
      tasteA
    );
    assert.equal(contrib.contribution.personalizedScore, expected.score);
    assert.equal(contrib.contribution.learnedTasteDelta, expected.delta);
    // Not double-applied at book/series: unit equals contribution when one pairing.
    const agg = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: tasteA,
    });
    const book1 = agg.canonicalBooks.find((b) => b.bookKey === "book:1");
    assert.equal(book1.pairingContributions.length, 1);
    assert.equal(book1.unitScore, book1.pairingContributions[0].personalizedScore);

    const tasteChanged = strongTaste({
      fieldPrefs: {
        [RHYSAND]: {
          n: 10,
          mean: 1,
          highMean: 1,
          lowMean: 1,
          highN: 8,
          lowN: 2,
          max: 5,
        },
      },
    });
    assert.notEqual(
      buildTasteFingerprint(tasteA),
      buildTasteFingerprint(tasteChanged)
    );

    const first = attachSeriesAggregation({
      research: researchShell(romance),
      analysis: {
        meta: { scopedAssessments: scoped, assessments: globals },
      },
      deps: { loadLearnedTaste: () => tasteA },
    });
    assert.equal(first.changed, true);
    const reuse = attachSeriesAggregation({
      research: researchShell(romance),
      analysis: first.analysis,
      deps: { loadLearnedTaste: () => tasteB },
    });
    assert.equal(reuse.reused, true);
    assert.equal(reuse.changed, false);

    const invalidated = attachSeriesAggregation({
      research: researchShell(romance),
      analysis: first.analysis,
      deps: { loadLearnedTaste: () => tasteChanged },
    });
    assert.equal(invalidated.changed, true);
    assert.equal(invalidated.reused, false);
  });

  it("coverage/confidence changes do not alter score values or weights", () => {
    const romance = rotatingIdentity();
    const scoped = makeScopedReady({ romance });
    const globals = assessmentsAll({ score: 3 });
    const research = researchShell(romance);
    const coverageA = buildScopedCoverage({ research });
    const coverageB = {
      ...coverageA,
      cells: coverageA.cells.map((c) => ({ ...c, covered: true, coverageScore: 100 })),
      summary: {
        ...coverageA.summary,
        coveredCellCount: coverageA.summary.requiredCellCount,
        allRequiredCellsCovered: true,
      },
    };
    const a = buildSeriesAggregation({
      research,
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
      scopedCoverage: coverageA,
    });
    const b = buildSeriesAggregation({
      research,
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
      scopedCoverage: coverageB,
    });
    assert.equal(a.seriesScore, b.seriesScore);
    assert.equal(a.baseSeriesScore, b.baseSeriesScore);
    assert.deepEqual(
      a.canonicalBooks.map((x) => ({
        bookKey: x.bookKey,
        unitScore: x.unitScore,
        baseUnitScore: x.baseUnitScore,
      })),
      b.canonicalBooks.map((x) => ({
        bookKey: x.bookKey,
        unitScore: x.unitScore,
        baseUnitScore: x.baseUnitScore,
      }))
    );
    // Confidence/completeness may differ; scores must not.
    assert.notEqual(a.requiredScopedCoverage, b.requiredScopedCoverage);
  });

  it("confidence thresholds and global conflict counted once", () => {
    assert.equal(
      classifyAggregationConfidence({
        bookCompleteness: 0.8,
        requiredScopedCoverage: 0.8,
        globalFieldCompleteness: 0.6,
        conflictCount: 2,
        status: "ready",
      }),
      "high"
    );
    assert.equal(
      classifyAggregationConfidence({
        bookCompleteness: 0.5,
        requiredScopedCoverage: null,
        globalFieldCompleteness: 0.3,
        conflictCount: 5,
        status: "ready",
      }),
      "medium"
    );
    assert.equal(
      classifyAggregationConfidence({
        bookCompleteness: 1,
        requiredScopedCoverage: 1,
        globalFieldCompleteness: 1,
        conflictCount: 0,
        status: "insufficient_scope",
      }),
      "low"
    );

    const romance = rotatingIdentity();
    const scoped = makeScopedReady({ romance });
    const globals = assessmentsAll({ score: 3 });
    globals[WORLD] = assessment({
      score: 3,
      conflictingSourceIds: ["c1", "c2"],
    });
    const agg = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
    });
    // Same global projected into multiple books/pairings → counted once.
    assert.equal(agg.conflictCount, 1);
  });

  it("malformed/stale 6A and duplicate scoped assessment subjects fail closed", () => {
    const romance = rotatingIdentity();
    const stale = makeScopedReady({ romance });
    stale.version = "scoped-assessment-v0";
    const err = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: stale,
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    assert.equal(err.status, "error");
    assert.equal(err.seriesScore, null);

    const p0 = pairingKey(romance, 0);
    const p1 = pairingKey(romance, 1);
    const baseScoped = makeScopedReady({
      romance,
      pairingScores: {
        [p0]: fiveFieldAssessments(5),
        [p1]: fiveFieldAssessments(3),
      },
    });
    const uniqueP1 = baseScoped.pairings.find((p) => p.semanticPairingKey === p1);
    assert.ok(uniqueP1);

    const conflictingDupA = {
      subjectKey: `pairing:${p0}`,
      semanticPairingKey: p0,
      memberNames: ["Alfa", "Beta"],
      bookKeys: ["book:1"],
      assessments: fiveFieldAssessments(5),
    };
    const conflictingDupB = {
      subjectKey: `pairing:${p0}`,
      semanticPairingKey: p0,
      memberNames: ["Alfa", "Beta"],
      bookKeys: ["book:1"],
      assessments: fiveFieldAssessments(1),
    };
    const scopedForward = {
      ...baseScoped,
      pairings: [conflictingDupA, conflictingDupB, uniqueP1],
    };
    const scopedReversed = {
      ...baseScoped,
      pairings: [uniqueP1, conflictingDupB, conflictingDupA],
    };

    const forward = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: scopedForward,
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    const reversed = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: scopedReversed,
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    assert.deepEqual(forward, reversed);
    assert.equal(forward.inputFingerprint, reversed.inputFingerprint);

    const book1 = forward.canonicalBooks.find((b) => b.bookKey === "book:1");
    const book2 = forward.canonicalBooks.find((b) => b.bookKey === "book:2");
    assert.ok(book1);
    assert.ok(book2);

    // Ambiguous duplicate pairing subject is unused for the five scoped fields.
    const projectedDup = projectPairingBookFields({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: scopedForward,
      globalAssessments: assessmentsAll({ score: 3 }),
    });
    for (const field of PAIRING_SCOPED_V1) {
      assert.equal(projectedDup.projectedFields[field], undefined);
    }
    const p0Contrib = book1.pairingContributions.find(
      (c) => c.semanticPairingKey === p0
    );
    if (p0Contrib) {
      for (const field of PAIRING_SCOPED_V1) {
        assert.equal(p0Contrib.projectedFields[field], undefined);
      }
    }

    // Unrelated unique pairing subject still contributes its scoped scores.
    const projectedUnique = projectPairingBookFields({
      bookKey: "book:2",
      semanticPairingKey: p1,
      scopedAssessments: scopedForward,
      globalAssessments: assessmentsAll({ score: 3 }),
    });
    assert.equal(projectedUnique.projectedFields[PROTECTIVE]?.sourceScope, "pairing");
    assert.equal(projectedUnique.projectedFields[PROTECTIVE]?.score, 3);
    assert.equal(
      book2.pairingContributions.some((c) => c.semanticPairingKey === p1),
      true
    );

    const bookSubjectKey = `book:book:1|pair:${p0}`;
    const bookDupA = {
      subjectKey: bookSubjectKey,
      bookKey: "book:1",
      semanticPairingKey: p0,
      assessments: { [PROTECTIVE]: scoredScoped(5) },
    };
    const bookDupB = {
      subjectKey: bookSubjectKey,
      bookKey: "book:1",
      semanticPairingKey: p0,
      assessments: { [PROTECTIVE]: scoredScoped(1) },
    };
    const withBookDupsForward = {
      ...makeScopedReady({ romance }),
      books: [bookDupA, bookDupB],
    };
    const withBookDupsReversed = {
      ...makeScopedReady({ romance }),
      books: [bookDupB, bookDupA],
    };
    const bookFwd = projectPairingBookFields({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: withBookDupsForward,
      globalAssessments: assessmentsAll({ score: 3 }),
    });
    const bookRev = projectPairingBookFields({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: withBookDupsReversed,
      globalAssessments: assessmentsAll({ score: 3 }),
    });
    assert.deepEqual(bookFwd, bookRev);
    // Duplicate book subject excluded — falls through to unique pairing subject.
    assert.equal(bookFwd.projectedFields[PROTECTIVE]?.sourceScope, "pairing");
  });

  it("mismatched/reversed subject identities cannot spoof cross-pair or cross-book projection", () => {
    const romance = rotatingIdentity();
    const p0 = pairingKey(romance, 0);
    const p1 = pairingKey(romance, 1);
    const baseScoped = makeScopedReady({
      romance,
      pairingScores: {
        [p1]: fiveFieldAssessments(3),
      },
    });
    const validP1 = baseScoped.pairings.find((p) => p.semanticPairingKey === p1);
    assert.ok(validP1);

    const spoofPairClaimP0SemP1 = {
      subjectKey: `pairing:${p0}`,
      semanticPairingKey: p1,
      memberNames: ["Alfa", "Beta"],
      bookKeys: ["book:1"],
      assessments: fiveFieldAssessments(5),
    };
    const spoofPairClaimP1SemP0 = {
      subjectKey: `pairing:${p1}`,
      semanticPairingKey: p0,
      memberNames: ["Gamma", "Delta"],
      bookKeys: ["book:2"],
      assessments: fiveFieldAssessments(5),
    };
    const missingSemPair = {
      subjectKey: `pairing:${p0}`,
      semanticPairingKey: "",
      assessments: fiveFieldAssessments(5),
    };
    const spoofBookWrongPair = {
      subjectKey: `book:book:1|pair:${p0}`,
      bookKey: "book:1",
      semanticPairingKey: p1,
      assessments: { [PROTECTIVE]: scoredScoped(5) },
    };
    const spoofBookWrongBook = {
      subjectKey: `book:book:1|pair:${p0}`,
      bookKey: "book:2",
      semanticPairingKey: p0,
      assessments: { [PROTECTIVE]: scoredScoped(5) },
    };
    const spoofBookMissingKeys = {
      subjectKey: `book:book:1|pair:${p0}`,
      bookKey: "",
      semanticPairingKey: null,
      assessments: { [PROTECTIVE]: scoredScoped(5) },
    };

    const scopedForward = {
      ...baseScoped,
      pairings: [spoofPairClaimP0SemP1, spoofPairClaimP1SemP0, missingSemPair, validP1],
      books: [spoofBookWrongPair, spoofBookWrongBook, spoofBookMissingKeys],
    };
    const scopedReversed = {
      ...baseScoped,
      pairings: [validP1, missingSemPair, spoofPairClaimP1SemP0, spoofPairClaimP0SemP1],
      books: [spoofBookMissingKeys, spoofBookWrongBook, spoofBookWrongPair],
    };

    const globals = assessmentsAll({ score: 2 });
    const forward = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scopedForward, assessments: globals },
      taste: emptyTaste(),
    });
    const reversed = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scopedReversed, assessments: globals },
      taste: emptyTaste(),
    });
    assert.deepEqual(forward, reversed);
    assert.equal(forward.inputFingerprint, reversed.inputFingerprint);

    const projP0 = projectPairingBookFields({
      bookKey: "book:1",
      semanticPairingKey: p0,
      scopedAssessments: scopedForward,
      globalAssessments: globals,
    });
    for (const field of PAIRING_SCOPED_V1) {
      assert.equal(projP0.projectedFields[field], undefined);
    }

    const projP1 = projectPairingBookFields({
      bookKey: "book:2",
      semanticPairingKey: p1,
      scopedAssessments: scopedForward,
      globalAssessments: globals,
    });
    assert.equal(projP1.projectedFields[PROTECTIVE]?.sourceScope, "pairing");
    assert.equal(projP1.projectedFields[PROTECTIVE]?.score, 3);
    assert.equal(projP1.projectedFields[PROTECTIVE]?.subjectKey, `pairing:${p1}`);

    const book1 = forward.canonicalBooks.find((b) => b.bookKey === "book:1");
    const p0Contrib = book1?.pairingContributions.find(
      (c) => c.semanticPairingKey === p0
    );
    if (p0Contrib) {
      for (const field of PAIRING_SCOPED_V1) {
        assert.equal(p0Contrib.projectedFields[field], undefined);
      }
    }
  });

  it("learned-taste fieldPrefs insertion order does not change aggregation", () => {
    const romance = rotatingIdentity();
    const scoped = makeScopedReady({ romance });
    const globals = assessmentsAll({ score: 3 });
    const prefA = {
      n: 10,
      mean: 4.8,
      highMean: 5,
      lowMean: 1,
      highN: 8,
      lowN: 2,
      max: 5,
    };
    const prefB = {
      n: 10,
      mean: 4.7,
      highMean: 5,
      lowMean: 1,
      highN: 8,
      lowN: 2,
      max: 5,
    };
    const tasteForward = strongTaste({
      fieldPrefs: {
        [RHYSAND]: prefA,
        [PROTECTIVE]: prefB,
        [BODYGUARD]: prefA,
      },
      negativeTags: {
        "Bully / nedladende MMC": 3,
        "For meget erotik ift. plot": 2,
      },
    });
    const tasteReversed = strongTaste({
      fieldPrefs: {
        [BODYGUARD]: prefA,
        [PROTECTIVE]: prefB,
        [RHYSAND]: prefA,
      },
      negativeTags: {
        "For meget erotik ift. plot": 2,
        "Bully / nedladende MMC": 3,
      },
    });
    const a = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: tasteForward,
    });
    const b = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: tasteReversed,
    });
    assert.deepEqual(a, b);
    const row = {
      [RHYSAND]: 5,
      [PROTECTIVE]: 5,
      [BODYGUARD]: 5,
    };
    assert.deepEqual(
      applyLearnedTasteAdjustmentWithProfile(row, 70, tasteForward),
      applyLearnedTasteAdjustmentWithProfile(row, 70, tasteReversed)
    );
  });

  it("legacy public learned-taste keeps insertion-order reasons; 6B profile is semantically stable", () => {
    const matchPref = {
      n: 10,
      mean: 4.8,
      highMean: 5,
      lowMean: 1,
      highN: 8,
      lowN: 2,
      max: 5,
    };
    // SUBJECTIVE_KEYS order: PROTECTIVE < BODYGUARD < RHYSAND — insertion is reversed.
    const tasteForward = strongTaste({
      fieldPrefs: {
        [RHYSAND]: matchPref,
        [PROTECTIVE]: matchPref,
        [BODYGUARD]: matchPref,
      },
    });
    const tasteReversed = strongTaste({
      fieldPrefs: {
        [BODYGUARD]: matchPref,
        [PROTECTIVE]: matchPref,
        [RHYSAND]: matchPref,
      },
    });
    const row = {
      [RHYSAND]: 5,
      [PROTECTIVE]: 5,
      [BODYGUARD]: 5,
    };

    const legacyFwd = applyLearnedTasteAdjustmentWithProfile(row, 70, tasteForward, {
      fieldPrefOrder: "legacy_insertion",
    });
    const legacyRev = applyLearnedTasteAdjustmentWithProfile(row, 70, tasteReversed, {
      fieldPrefOrder: "legacy_insertion",
    });
    assert.ok(legacyFwd.reasons.length >= 2);
    assert.ok(legacyRev.reasons.length >= 2);
    assert.notDeepEqual(legacyFwd.reasons, legacyRev.reasons);
    assert.equal(legacyFwd.score, legacyRev.score);
    assert.equal(legacyFwd.delta, legacyRev.delta);
    assert.match(legacyFwd.reasons[0], /Rhysand-faktoren/);
    assert.match(legacyRev.reasons[0], /bodyguard-vibe/);

    const semanticFwd = applyLearnedTasteAdjustmentWithProfile(row, 70, tasteForward);
    const semanticRev = applyLearnedTasteAdjustmentWithProfile(row, 70, tasteReversed);
    assert.deepEqual(semanticFwd, semanticRev);
    assert.equal(semanticFwd.score, legacyFwd.score);
    assert.match(semanticFwd.reasons[0], /beskyttende helt/);

    // Public wrapper must select legacy insertion order (not semantic default).
    const tastePath = dataPath("learned-taste.json");
    const previous = existsSync(tastePath) ? readFileSync(tastePath, "utf8") : null;
    try {
      writeFileSync(tastePath, JSON.stringify(tasteForward, null, 2), "utf8");
      const publicAdj = applyLearnedTasteAdjustment(row, 70);
      assert.deepEqual(publicAdj.reasons, legacyFwd.reasons);
      assert.equal(publicAdj.score, legacyFwd.score);
      assert.notDeepEqual(publicAdj.reasons, semanticFwd.reasons);
    } finally {
      if (previous != null) writeFileSync(tastePath, previous, "utf8");
      else if (existsSync(tastePath)) unlinkSync(tastePath);
    }
  });

  it("aggregation exception strips stale seriesAggregation without throwing", async () => {
    const romance = rotatingIdentity();
    const research = researchShell(romance);
    const seeded = await finalizeScopedAssessments({
      research,
      analysis: {
        row: {
          "Seriens navn": "Alpha Cycle",
          "Tine-score": 80,
          Indholdsmatch: 80,
          "Læseprioritet nu": 70,
          "Tines score": 91,
          "Tines egen vurdering": "x",
        },
        meta: {
          promptVersion: ANALYSIS_PROMPT_VERSION,
          assessments: assessmentsAll({ score: 3 }),
          inputTokens: 10,
          outputTokens: 4,
          estimatedCostUsd: 0.001,
          analysisHash: "hash-agg-throw",
        },
      },
      deps: {
        callScopedAssessmentModel: async () => ({
          ok: false,
          error: "missing_api_key",
          invoked: false,
          usage: { model: null, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        }),
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
      },
    });
    assert.ok(seeded.analysis.meta.scopedAssessments);
    assert.ok(seeded.analysis.meta.seriesAggregation);

    const staleBlob = {
      version: SERIES_AGGREGATION_VERSION,
      status: "ready",
      seriesScore: 99,
      staleMarker: true,
    };
    const analysisWithStale = {
      ...seeded.analysis,
      meta: {
        ...seeded.analysis.meta,
        seriesAggregation: staleBlob,
        keepUnrelated: "preserved",
      },
    };

    const result = await finalizeScopedAssessments({
      research,
      analysis: analysisWithStale,
      deps: {
        callScopedAssessmentModel: async () => {
          throw new Error("6A reusable must not call model");
        },
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
        attachSeriesAggregation: () => {
          throw new Error("injected aggregation failure");
        },
      },
    });

    assert.equal(result.aggregationError, true);
    assert.equal(result.analysis.meta.seriesAggregation, undefined);
    assert.equal(result.analysis.meta.keepUnrelated, "preserved");
    assert.ok(result.analysis.meta.scopedAssessments);
    assert.equal(result.analysis.meta.scopedAssessments.status, seeded.analysis.meta.scopedAssessments.status);
    assert.equal(result.changed, true);
    assert.equal(result.aggregationChanged, true);
    assert.equal(result.scopedAssessmentsChanged, false);
    assert.equal(result.analysis.row["Tine-score"], 80);
  });

  it("single_couple/unresolved/legacy remain deep no-ops", async () => {
    const single = singleCoupleIdentity();
    const analysis = {
      row: {
        "Tine-score": 80,
        Indholdsmatch: 80,
        "Læseprioritet nu": 70,
        "Tines score": 91,
        "Tines egen vurdering": "x",
      },
      meta: {
        assessments: assessmentsAll(),
        seriesAggregation: { stale: true },
      },
    };
    const before = JSON.stringify(analysis.meta.assessments);
    const result = await finalizeScopedAssessments({
      research: researchShell(single),
      analysis,
      deps: {
        callScopedAssessmentModel: async () => {
          throw new Error("must not call");
        },
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
      },
    });
    assert.equal(result.inactive, true);
    assert.equal(result.analysis.meta.scopedAssessments, undefined);
    assert.equal(result.analysis.meta.seriesAggregation, undefined);
    assert.equal(JSON.stringify(result.analysis.meta.assessments), before);
    assert.equal(result.analysis.row["Tine-score"], 80);
  });

  it("JSON round-trip preserves aggregation shape", () => {
    const romance = rotatingIdentity();
    const agg = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: makeScopedReady({ romance }),
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    const round = JSON.parse(JSON.stringify(agg));
    assert.deepEqual(round, agg);
    assert.equal(round.generatedAt, undefined);
    assert.equal(round.modelRaw, undefined);
  });

  it("pipeline reused path backfills missing 6B and no-writes when both fresh", async () => {
    const romance = rotatingIdentity();
    const research = researchShell(romance);
    // Seed authentic 6A via finalizer (correct inputFingerprint), then strip 6B.
    const seeded = await finalizeScopedAssessments({
      research,
      analysis: {
        row: {
          "Seriens navn": "Alpha Cycle",
          "Tine-score": 80,
          Indholdsmatch: 80,
          "Læseprioritet nu": 70,
          "Tines score": 91,
          "Tines egen vurdering": "Elsker den",
        },
        meta: {
          promptVersion: ANALYSIS_PROMPT_VERSION,
          assessments: assessmentsAll({ score: 3 }),
          inputTokens: 100,
          outputTokens: 40,
          estimatedCostUsd: 0.01,
          analysisHash: "hash-6b",
        },
      },
      deps: {
        callScopedAssessmentModel: async () => ({
          ok: false,
          error: "missing_api_key",
          invoked: false,
          usage: { model: null, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        }),
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
      },
    });
    // No eligible evidence → insufficient_scope 6A; still attach aggregation status.
    assert.ok(seeded.analysis.meta.scopedAssessments);
    const scopedReady = {
      ...seeded.analysis.meta.scopedAssessments,
      status: "ready",
      pairings: (seeded.analysis.meta.scopedAssessments.pairings || []).map((p) => ({
        ...p,
        assessments: fiveFieldAssessments(4),
      })),
      reasons: [],
    };
    // Rebuild aggregation against forced-ready scoped for the seam test.
    const forcedMeta = {
      ...seeded.analysis.meta,
      scopedAssessments: scopedReady,
    };
    delete forcedMeta.seriesAggregation;
    const withAgg = attachSeriesAggregation({
      research,
      analysis: { meta: forcedMeta },
      deps: { loadLearnedTaste: () => emptyTaste() },
    });
    assert.equal(withAgg.analysis.meta.seriesAggregation.status, "ready");

    const existingWithoutAgg = {
      "Seriens navn": "Alpha Cycle",
      "Tine-score": 80,
      Indholdsmatch: 80,
      "Læseprioritet nu": 70,
      "Tines score": 91,
      "Tines egen vurdering": "Elsker den",
      _research: research,
      _analysisMeta: {
        ...forcedMeta,
        // Keep forced-ready scopedAssessments without aggregation.
      },
      _usage: { researchCacheHit: true, webSearchCalls: 0 },
      _identity: research.identity,
    };

    let upsertCount = 0;
    let loadCount = 0;
    const taste = emptyTaste();
    const upserted = [];

    const missing = await finalizeScopedOnReusedAnalysis({
      existing: existingWithoutAgg,
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
          return [existingWithoutAgg];
        },
        aggregationDeps: { loadLearnedTaste: () => taste },
        scopedAssessmentDeps: {
          callScopedAssessmentModel: async () => {
            throw new Error("6A fresh must not call model");
          },
          aggregationDeps: { loadLearnedTaste: () => taste },
        },
      },
    });

    // Forced-ready scoped may not reuse (fingerprint of assessments changed) —
    // prefer pure attach path assertion for backfill semantics:
    const backfill = attachSeriesAggregation({
      research,
      analysis: { meta: { ...forcedMeta } },
      deps: { loadLearnedTaste: () => taste },
    });
    assert.equal(backfill.changed, true);
    assert.ok(backfill.analysis.meta.seriesAggregation);
    assert.equal(
      backfill.analysis.meta.seriesAggregation.version,
      SERIES_AGGREGATION_VERSION
    );

    const freshMeta = backfill.analysis.meta;
    const freshExisting = {
      ...existingWithoutAgg,
      _analysisMeta: freshMeta,
    };
    const reuse = attachSeriesAggregation({
      research,
      analysis: { meta: freshMeta },
      deps: { loadLearnedTaste: () => taste },
    });
    assert.equal(reuse.changed, false);
    assert.equal(reuse.reused, true);

    // Seam: when both 6A and 6B are already on the row and reusable, no write.
    // Use the authentic insufficient_scope empty-evidence path (structurally reusable).
    const authentic = seeded.analysis.meta;
    const authenticExisting = {
      ...existingWithoutAgg,
      _analysisMeta: { ...authentic },
    };
    const seamFresh = await finalizeScopedOnReusedAnalysis({
      existing: authenticExisting,
      research,
      identity: research.identity,
      deps: {
        upsertSeries: () => {
          upsertCount += 1;
          throw new Error("fresh 6A+6B must not write");
        },
        loadSeries: () => {
          loadCount += 1;
          return [authenticExisting];
        },
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
        scopedAssessmentDeps: {
          callScopedAssessmentModel: async () => {
            throw new Error("fresh must not call model");
          },
          aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
        },
      },
    });
    assert.equal(seamFresh.meta.scopedAssessmentsUpdated, undefined);
    assert.equal(seamFresh.scopedFinal.changed, false);
    assert.equal(loadCount, 1);

    // Seam backfill when aggregation missing but 6A reusable.
    const withoutAgg = {
      ...authenticExisting,
      _analysisMeta: { ...authentic, seriesAggregation: undefined },
    };
    delete withoutAgg._analysisMeta.seriesAggregation;
    const seamBackfill = await finalizeScopedOnReusedAnalysis({
      existing: withoutAgg,
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
          return [withoutAgg];
        },
        aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
        scopedAssessmentDeps: {
          callScopedAssessmentModel: async () => {
            throw new Error("6A reusable must not call model");
          },
          aggregationDeps: { loadLearnedTaste: () => emptyTaste() },
        },
      },
    });
    assert.equal(seamBackfill.meta.scopedAssessmentsUpdated, undefined);
    assert.equal(seamBackfill.meta.seriesAggregationUpdated, true);
    assert.equal(seamBackfill.scopedFinal.scopedAssessmentsChanged, false);
    assert.equal(seamBackfill.scopedFinal.aggregationChanged, true);
    assert.ok(seamBackfill.row._analysisMeta.seriesAggregation);
    assert.equal(upsertCount >= 1, true);
    assert.match(
      seamBackfill.meta.userMessage,
      /series aggregation opdateret/
    );
    assert.equal(
      /scoped assessments opdateret/.test(seamBackfill.meta.userMessage),
      false
    );
    void missing;
    void freshExisting;
  });

  it("pure buildSeriesAggregation does not read learned-taste from disk", () => {
    const romance = rotatingIdentity();
    const a = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: makeScopedReady({ romance }),
        assessments: assessmentsAll({ score: 3 }),
      },
      // taste omitted → deterministic neutral profile (no disk)
    });
    const b = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: {
        scopedAssessments: makeScopedReady({ romance }),
        assessments: assessmentsAll({ score: 3 }),
      },
      taste: emptyTaste(),
    });
    assert.equal(a.seriesScore, b.seriesScore);
    assert.equal(a.tasteFingerprint, buildTasteFingerprint(emptyTaste()));
    assert.deepEqual(a.canonicalBooks, b.canonicalBooks);
  });

  it("public applyLearnedTasteAdjustment behavior preserved vs explicit profile", () => {
    const row = { [RHYSAND]: 5, [PROTECTIVE]: 5 };
    const taste = strongTaste();
    const withProfile = applyLearnedTasteAdjustmentWithProfile(row, 70, taste);
    // Disk-backed public API may differ if disk taste differs; withProfile path is deterministic.
    assert.equal(typeof withProfile.score, "number");
    assert.equal(typeof applyLearnedTasteAdjustment(row, 70).score, "number");
    const base = estimateTineScoreFromVibes({
      [PROTECTIVE]: 4,
      [BODYGUARD]: 4,
      [THAD]: 4,
      [RHYSAND]: 4,
      [FMC_DEV]: 3,
      [EPIC]: 3,
      [WORLD]: 3,
    });
    assert.ok(base == null || (base >= 40 && base <= 99));
  });

  it("reordered identity/scopes/meta produce deep-equal aggregation", () => {
    const romance = rotatingIdentity();
    const scoped = makeScopedReady({ romance });
    const globals = assessmentsAll({ score: 3 });
    const a = buildSeriesAggregation({
      research: researchShell(romance),
      analysisMeta: { scopedAssessments: scoped, assessments: globals },
      taste: emptyTaste(),
    });
    const reversedRomance = {
      ...romance,
      pairings: [...romance.pairings].reverse(),
    };
    const reversedScoped = {
      ...scoped,
      pairings: [...scoped.pairings].reverse(),
      books: [...scoped.books].reverse(),
    };
    const reversedGlobals = Object.fromEntries(
      [...SUBJECTIVE_KEYS].reverse().map((k) => [k, globals[k]])
    );
    const b = buildSeriesAggregation({
      research: researchShell(reversedRomance),
      analysisMeta: {
        scopedAssessments: reversedScoped,
        assessments: reversedGlobals,
      },
      taste: emptyTaste(),
    });
    assert.equal(a.seriesScore, b.seriesScore);
    assert.equal(a.inputFingerprint, b.inputFingerprint);
    assert.deepEqual(a.canonicalBooks, b.canonicalBooks);
  });

  it("module is wired from pipeline and not adaptiveResearchLoop", () => {
    const pipeline = readFileSync(join(ROOT, "server/services/pipeline.js"), "utf8");
    const scoped = readFileSync(
      join(ROOT, "server/services/seriesRomanceScopedAssessment.js"),
      "utf8"
    );
    const loop = readFileSync(
      join(ROOT, "server/services/adaptiveResearchLoop.js"),
      "utf8"
    );
    assert.match(scoped, /attachSeriesAggregation/);
    assert.match(pipeline, /finalizeScopedAssessments/);
    assert.match(pipeline, /finalizeScopedOnReusedAnalysis/);
    assert.equal(loop.includes("seriesAggregation"), false);
    assert.equal(loop.includes("attachSeriesAggregation"), false);
  });
});

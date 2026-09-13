/**
 * Series Romance Structure 6B — deterministic equal-book series aggregation.
 *
 * Pure code-owned aggregate under _analysisMeta.seriesAggregation.
 * Does not change public row scores, research budgets, or model usage.
 */

import { stableHash } from "./hash.js";
import { SUBJECTIVE_KEYS, estimateTineScoreFromVibes } from "./decisionScores.js";
import {
  applyLearnedTasteAdjustmentWithProfile,
  buildTasteFingerprint,
  loadLearnedTaste,
} from "./learnedTaste.js";

/** Deterministic neutral profile — no disk I/O (pure builder default). */
const NEUTRAL_TASTE_PROFILE = Object.freeze({
  version: "learned-taste-v1",
  reviewCount: 0,
  scoredReviewCount: 0,
  updatedAt: null,
  fieldPrefs: Object.freeze({}),
  positiveTags: Object.freeze({}),
  negativeTags: Object.freeze({}),
  reread: Object.freeze({ yes: 0, maybe: 0, no: 0 }),
});
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  isRomanceScopePlanningReady,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "./seriesRomancePlanning.js";
import { pairingHasScope } from "./seriesRomanceDiscovery.js";
import { primaryPairings } from "./seriesRomanceIdentity.js";
import { buildIdentityFingerprint } from "./seriesRomanceSubjectBinding.js";
import {
  buildScopedCoverage,
  scopedBookScopeKey,
} from "./seriesRomanceScopedCoverage.js";
import {
  SCOPED_ASSESSMENT_PROMPT_VERSION,
  SCOPED_ASSESSMENT_VERSION,
  SERIES_AGGREGATION_VERSION,
} from "./versions.js";

export { SERIES_AGGREGATION_VERSION };

/** Exact same five fields as Structure 6A PAIRING_SCOPED_V1. */
export const PAIRING_SCOPED_V1 = Object.freeze([
  ...ROMANCE_SCOPE_ELIGIBLE_FIELDS,
]);

/** Exact same residual SUBJECTIVE_KEYS as Structure 6A SERIES_GLOBAL_V1. */
export const SERIES_GLOBAL_V1 = Object.freeze(
  SUBJECTIVE_KEYS.filter((field) => !PAIRING_SCOPED_V1.includes(field))
);

export const SERIES_AGGREGATION_POLICY = Object.freeze({
  weighting: "equal_book",
  withinBook: "equal_primary_pairing",
  partial: "exclude_missing_reduce_confidence",
  membership: "canonical_books_primary_only",
});

const AGG_STATUS = Object.freeze(["ready", "insufficient_scope", "error"]);

function compareAscii(a, b) {
  if (a === b) return 0;
  return String(a) < String(b) ? -1 : 1;
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function pairingSemanticKeyFromPairing(pairing) {
  return semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing?.members),
    bookScopes: pairing?.bookScopes || [],
    arcScopes: pairing?.arcScopes || [],
  });
}

function eligiblePrimaryPairings(romance) {
  return primaryPairings(romance).filter(
    (pairing) =>
      pairing?.prominence === "primary" &&
      pairingHasScope(pairing) &&
      sortedDisplayMemberNames(pairing.members).length > 0
  );
}

function isFiniteScore(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidScopedAssessment(assessment) {
  return (
    assessment &&
    typeof assessment === "object" &&
    assessment.status === "scored" &&
    isFiniteScore(assessment.score)
  );
}

function isValidGlobalAssessment(assessment) {
  return assessment && typeof assessment === "object" && isFiniteScore(assessment.score);
}

function conflictIdsOfScoped(assessment) {
  return Array.isArray(assessment?.conflictingRecordIds)
    ? assessment.conflictingRecordIds.filter((id) => typeof id === "string" && id)
    : [];
}

function conflictIdsOfGlobal(assessment) {
  return Array.isArray(assessment?.conflictingSourceIds)
    ? assessment.conflictingSourceIds.filter((id) => typeof id === "string" && id)
    : [];
}

function meanRounded(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / values.length);
}

/**
 * Canonical books = union of bookScopes from eligible primary pairings only.
 * Dedup by scopedBookScopeKey; display fields order-independent.
 */
export function buildCanonicalBooksFromIdentity(romance) {
  const bookMap = new Map();
  const pairingByKey = new Map();

  for (const pairing of eligiblePrimaryPairings(romance)) {
    const pairKey = pairingSemanticKeyFromPairing(pairing);
    if (!pairKey) continue;
    if (!pairingByKey.has(pairKey)) {
      pairingByKey.set(pairKey, pairing);
    }
  }

  const sortedPairKeys = [...pairingByKey.keys()].sort(compareAscii);

  for (const pairKey of sortedPairKeys) {
    const pairing = pairingByKey.get(pairKey);
    for (const book of pairing?.bookScopes || []) {
      const bookKey = scopedBookScopeKey(book);
      if (!bookKey) continue;
      if (!bookMap.has(bookKey)) {
        bookMap.set(bookKey, {
          bookKey,
          bookNumbers: [],
          titles: [],
          primaryPairingKeys: new Set(),
        });
      }
      const entry = bookMap.get(bookKey);
      entry.primaryPairingKeys.add(pairKey);
      if (book?.bookNumber != null && Number.isFinite(Number(book.bookNumber))) {
        entry.bookNumbers.push(Number(book.bookNumber));
      }
      const title = normalizeName(book?.title);
      if (title) entry.titles.push(title);
    }
  }

  const books = [];
  for (const entry of bookMap.values()) {
    const uniqueNumbers = [...new Set(entry.bookNumbers)].sort((a, b) => a - b);
    let bookNumber = null;
    if (entry.bookKey.startsWith("book:")) {
      const n = Number(entry.bookKey.slice(5));
      bookNumber = Number.isFinite(n) ? n : uniqueNumbers[0] ?? null;
    } else {
      bookNumber = uniqueNumbers.length === 1 ? uniqueNumbers[0] : null;
    }
    const uniqueTitles = [...new Set(entry.titles)].sort(compareAscii);
    const title = uniqueTitles[0] || null;
    books.push({
      bookKey: entry.bookKey,
      bookNumber,
      title,
      primaryPairingKeys: [...entry.primaryPairingKeys].sort(compareAscii),
    });
  }

  books.sort((a, b) => compareAscii(a.bookKey, b.bookKey));
  return books;
}

function countKeys(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Code-controlled canonical pairing subjectKey (matches 6A buildSubjectKey). */
function canonicalPairingSubjectKey(pairKey) {
  return `pairing:${pairKey}`;
}

/** Code-controlled canonical book subjectKey (matches 6A buildSubjectKey). */
function canonicalBookSubjectKey(bookKey, pairKey) {
  return `book:${bookKey}|pair:${pairKey}`;
}

function isCanonicalPairingSubject(subject) {
  const pairKey =
    typeof subject?.semanticPairingKey === "string" ? subject.semanticPairingKey : "";
  if (!pairKey) return false;
  return subject.subjectKey === canonicalPairingSubjectKey(pairKey);
}

function isCanonicalBookSubject(subject) {
  const bookKey = typeof subject?.bookKey === "string" ? subject.bookKey : "";
  const pairKey =
    typeof subject?.semanticPairingKey === "string" ? subject.semanticPairingKey : "";
  if (!bookKey || !pairKey) return false;
  return subject.subjectKey === canonicalBookSubjectKey(bookKey, pairKey);
}

/**
 * Index scoped subjects fail-closed:
 * - Pairing/book subjects must carry canonical code-owned identity
 *   (subjectKey matches pairing:/book:…|pair:… from semantic fields).
 * - Ambiguous duplicate pairing subjectKey / semanticPairingKey or duplicate
 *   book subjectKey are excluded entirely (order-independent).
 * Mismatched/missing identities contribute nothing; unrelated unique subjects
 * remain usable. Fingerprinting and projection share this index.
 */
function indexScopedSubjects(scopedAssessments) {
  const pairingSubjects = (scopedAssessments?.pairings || []).filter(
    (s) =>
      s &&
      typeof s === "object" &&
      typeof s.subjectKey === "string" &&
      s.subjectKey &&
      isCanonicalPairingSubject(s)
  );
  const bookSubjects = (scopedAssessments?.books || []).filter(
    (s) =>
      s &&
      typeof s === "object" &&
      typeof s.subjectKey === "string" &&
      s.subjectKey &&
      isCanonicalBookSubject(s)
  );

  const pairingSkCounts = countKeys(pairingSubjects, (s) => s.subjectKey);
  const pairingSemCounts = countKeys(
    pairingSubjects,
    (s) => s.semanticPairingKey
  );

  const pairingCandidates = pairingSubjects.filter((s) => {
    if ((pairingSkCounts.get(s.subjectKey) || 0) > 1) return false;
    if ((pairingSemCounts.get(s.semanticPairingKey) || 0) > 1) return false;
    return true;
  });

  // Detect subjectKey ↔ sem: namespace collisions across distinct candidates.
  const keyOwners = new Map();
  const collidedPairingSubjectKeys = new Set();
  for (const subject of pairingCandidates) {
    const keys = [
      subject.subjectKey,
      `sem:${subject.semanticPairingKey}`,
    ];
    for (const key of keys) {
      const owner = keyOwners.get(key);
      if (owner && owner !== subject.subjectKey) {
        collidedPairingSubjectKeys.add(owner);
        collidedPairingSubjectKeys.add(subject.subjectKey);
      } else if (!owner) {
        keyOwners.set(key, subject.subjectKey);
      }
    }
  }

  const pairings = new Map();
  for (const subject of pairingCandidates) {
    if (collidedPairingSubjectKeys.has(subject.subjectKey)) continue;
    pairings.set(subject.subjectKey, subject);
    pairings.set(`sem:${subject.semanticPairingKey}`, subject);
  }

  const bookSkCounts = countKeys(bookSubjects, (s) => s.subjectKey);
  const books = new Map();
  for (const subject of bookSubjects) {
    if ((bookSkCounts.get(subject.subjectKey) || 0) > 1) continue;
    books.set(subject.subjectKey, subject);
  }

  return { pairings, books };
}

/**
 * Exact field projection for primary pairing P in canonical book B.
 */
export function projectPairingBookFields({
  bookKey,
  semanticPairingKey: pairKey,
  scopedAssessments = null,
  globalAssessments = null,
} = {}) {
  const { pairings, books } = indexScopedSubjects(scopedAssessments);
  const pairingSubject =
    pairings.get(`pairing:${pairKey}`) || pairings.get(`sem:${pairKey}`) || null;
  const bookSubjectKey = `book:${bookKey}|pair:${pairKey}`;
  const bookSubject = books.get(bookSubjectKey) || null;

  const projectedFields = {};
  const usedConflicts = new Map();

  const markConflict = (entryKey, assessment, kind) => {
    if (usedConflicts.has(entryKey)) return;
    const ids =
      kind === "scoped" ? conflictIdsOfScoped(assessment) : conflictIdsOfGlobal(assessment);
    if (ids.length > 0) {
      usedConflicts.set(entryKey, true);
    }
  };

  for (const field of SUBJECTIVE_KEYS) {
    const isPairingScoped = PAIRING_SCOPED_V1.includes(field);
    const isSeriesGlobal = SERIES_GLOBAL_V1.includes(field);

    // a) valid 6A book assessment for B+P+field (five scoped fields only)
    if (isPairingScoped && bookSubject) {
      const bookAssessment = bookSubject.assessments?.[field];
      if (isValidScopedAssessment(bookAssessment)) {
        projectedFields[field] = {
          score: bookAssessment.score,
          sourceScope: "book",
          subjectKey: bookSubject.subjectKey,
        };
        markConflict(`scoped:${bookSubject.subjectKey}:${field}`, bookAssessment, "scoped");
        continue;
      }
    }

    // b) valid 6A pairing assessment for P+field, only for PAIRING_SCOPED_V1
    if (isPairingScoped && pairingSubject) {
      const pairingAssessment = pairingSubject.assessments?.[field];
      if (isValidScopedAssessment(pairingAssessment)) {
        projectedFields[field] = {
          score: pairingAssessment.score,
          sourceScope: "pairing",
          subjectKey: pairingSubject.subjectKey,
        };
        markConflict(
          `scoped:${pairingSubject.subjectKey}:${field}`,
          pairingAssessment,
          "scoped"
        );
        continue;
      }
    }

    // c) valid existing global assessment only for SERIES_GLOBAL_V1
    // Never use legacy global as fallback for the five scoped fields.
    if (isSeriesGlobal) {
      const globalAssessment = globalAssessments?.[field];
      if (isValidGlobalAssessment(globalAssessment)) {
        projectedFields[field] = {
          score: globalAssessment.score,
          sourceScope: "global",
          subjectKey: `global:${field}`,
        };
        markConflict(`global:${field}`, globalAssessment, "global");
        continue;
      }
    }

    // d) missing — omit from projectedFields
  }

  return { projectedFields, conflictEntryKeys: [...usedConflicts.keys()].sort(compareAscii) };
}

function projectedRowFromFields(projectedFields) {
  const row = {};
  for (const [field, entry] of Object.entries(projectedFields || {})) {
    if (entry && isFiniteScore(entry.score)) row[field] = entry.score;
  }
  return row;
}

export function buildPairingBookContribution({
  bookKey,
  semanticPairingKey: pairKey,
  scopedAssessments = null,
  globalAssessments = null,
  taste = null,
} = {}) {
  const { projectedFields, conflictEntryKeys } = projectPairingBookFields({
    bookKey,
    semanticPairingKey: pairKey,
    scopedAssessments,
    globalAssessments,
  });
  const projectedRow = projectedRowFromFields(projectedFields);
  const baseScore = estimateTineScoreFromVibes(projectedRow);
  if (!isFiniteScore(baseScore)) {
    return {
      contribution: null,
      conflictEntryKeys,
      excludedReason: "missing_or_invalid_base_score",
    };
  }

  const adjustment = applyLearnedTasteAdjustmentWithProfile(
    projectedRow,
    baseScore,
    taste
  );
  const personalizedScore = adjustment?.score;
  if (!isFiniteScore(personalizedScore)) {
    return {
      contribution: null,
      conflictEntryKeys,
      excludedReason: "missing_or_invalid_personalized_score",
    };
  }

  const orderedFields = {};
  for (const field of SUBJECTIVE_KEYS) {
    if (projectedFields[field]) orderedFields[field] = projectedFields[field];
  }

  return {
    contribution: {
      semanticPairingKey: pairKey,
      baseScore,
      personalizedScore,
      learnedTasteDelta: adjustment.delta || 0,
      learnedTasteReasons: [...(adjustment.reasons || [])],
      projectedFields: orderedFields,
    },
    conflictEntryKeys,
    excludedReason: null,
  };
}

function normalizeScopedAssessmentForFingerprint(assessment) {
  if (!assessment || typeof assessment !== "object") return null;
  return {
    status: assessment.status ?? null,
    score: isFiniteScore(assessment.score) ? assessment.score : null,
    confidence: assessment.confidence ?? null,
    basis: assessment.basis ?? null,
    conflictingRecordIds: [...conflictIdsOfScoped(assessment)].sort(compareAscii),
  };
}

function normalizeGlobalAssessmentForFingerprint(assessment) {
  if (!assessment || typeof assessment !== "object") return null;
  return {
    score: isFiniteScore(assessment.score) ? assessment.score : null,
    confidence: assessment.confidence ?? null,
    basis: assessment.basis ?? null,
    conflictingSourceIds: [...conflictIdsOfGlobal(assessment)].sort(compareAscii),
  };
}

function relevantScopedForFingerprint(scopedAssessments, canonicalBooks) {
  const pairKeys = new Set();
  const bookKeys = new Set();
  for (const book of canonicalBooks) {
    bookKeys.add(book.bookKey);
    for (const pk of book.primaryPairingKeys) pairKeys.add(pk);
  }

  // Same fail-closed index as projection: ambiguous duplicates contribute nothing.
  const { pairings: pairingIndex, books: bookIndex } =
    indexScopedSubjects(scopedAssessments);

  const seenPairings = new Set();
  const pairings = [];
  for (const subject of pairingIndex.values()) {
    if (seenPairings.has(subject.subjectKey)) continue;
    seenPairings.add(subject.subjectKey);
    if (!pairKeys.has(subject?.semanticPairingKey)) continue;
    const assessments = {};
    for (const field of PAIRING_SCOPED_V1) {
      assessments[field] = normalizeScopedAssessmentForFingerprint(
        subject.assessments?.[field]
      );
    }
    pairings.push({
      subjectKey: subject.subjectKey,
      semanticPairingKey: subject.semanticPairingKey,
      assessments,
    });
  }
  pairings.sort((a, b) => compareAscii(a.subjectKey, b.subjectKey));

  const seenBooks = new Set();
  const books = [];
  for (const subject of bookIndex.values()) {
    if (seenBooks.has(subject.subjectKey)) continue;
    seenBooks.add(subject.subjectKey);
    if (!bookKeys.has(subject?.bookKey)) continue;
    if (!pairKeys.has(subject?.semanticPairingKey)) continue;
    const assessments = {};
    for (const field of PAIRING_SCOPED_V1) {
      assessments[field] = normalizeScopedAssessmentForFingerprint(
        subject.assessments?.[field]
      );
    }
    books.push({
      subjectKey: subject.subjectKey,
      bookKey: subject.bookKey,
      semanticPairingKey: subject.semanticPairingKey,
      assessments,
    });
  }
  books.sort((a, b) => compareAscii(a.subjectKey, b.subjectKey));

  return { pairings, books };
}

function relevantGlobalForFingerprint(globalAssessments) {
  const out = {};
  for (const field of SERIES_GLOBAL_V1) {
    out[field] = normalizeGlobalAssessmentForFingerprint(globalAssessments?.[field]);
  }
  return out;
}

function coverageMetricsForFingerprint(scopedCoverage, linkedPairKeys) {
  if (!scopedCoverage || scopedCoverage.active !== true) {
    return { required: 0, covered: 0 };
  }
  const cells = Array.isArray(scopedCoverage.cells) ? scopedCoverage.cells : [];
  let required = 0;
  let covered = 0;
  for (const cell of cells) {
    if (cell?.requirement !== "required") continue;
    if (!linkedPairKeys.has(cell.semanticPairingKey)) continue;
    required += 1;
    if (cell.covered) covered += 1;
  }
  return { required, covered };
}

export function buildSeriesAggregationInputFingerprint({
  canonicalBooks = [],
  scopedAssessments = null,
  globalAssessments = null,
  scopedCoverage = null,
} = {}) {
  const linkedPairKeys = new Set();
  for (const book of canonicalBooks) {
    for (const pk of book.primaryPairingKeys || []) linkedPairKeys.add(pk);
  }
  const booksPayload = canonicalBooks.map((b) => ({
    bookKey: b.bookKey,
    bookNumber: b.bookNumber ?? null,
    title: b.title ?? null,
    primaryPairingKeys: [...(b.primaryPairingKeys || [])].sort(compareAscii),
  }));
  booksPayload.sort((a, b) => compareAscii(a.bookKey, b.bookKey));

  return stableHash({
    version: SERIES_AGGREGATION_VERSION,
    policy: { ...SERIES_AGGREGATION_POLICY },
    scopedAssessmentVersion: SCOPED_ASSESSMENT_VERSION,
    scopedAssessmentPromptVersion: SCOPED_ASSESSMENT_PROMPT_VERSION,
    scopedStatus: scopedAssessments?.status ?? null,
    scopedInputFingerprint: scopedAssessments?.inputFingerprint ?? null,
    identityFingerprint: scopedAssessments?.identityFingerprint ?? null,
    canonicalBooks: booksPayload,
    scoped: relevantScopedForFingerprint(scopedAssessments, canonicalBooks),
    global: relevantGlobalForFingerprint(globalAssessments),
    coverage: coverageMetricsForFingerprint(scopedCoverage, linkedPairKeys),
  });
}

function computeRequiredScopedCoverage(scopedCoverage, linkedPairKeys) {
  if (!scopedCoverage || scopedCoverage.active !== true) return null;
  const cells = Array.isArray(scopedCoverage.cells) ? scopedCoverage.cells : [];
  let required = 0;
  let covered = 0;
  for (const cell of cells) {
    if (cell?.requirement !== "required") continue;
    if (!linkedPairKeys.has(cell.semanticPairingKey)) continue;
    required += 1;
    if (cell.covered) covered += 1;
  }
  if (required === 0) return null;
  return covered / required;
}

function computeGlobalFieldCompleteness(globalAssessments) {
  if (!SERIES_GLOBAL_V1.length) return 0;
  let scored = 0;
  for (const field of SERIES_GLOBAL_V1) {
    if (isValidGlobalAssessment(globalAssessments?.[field])) scored += 1;
  }
  return scored / SERIES_GLOBAL_V1.length;
}

export function classifyAggregationConfidence({
  bookCompleteness,
  requiredScopedCoverage,
  globalFieldCompleteness,
  conflictCount,
  status,
} = {}) {
  if (status === "insufficient_scope") return "low";
  if (status === "error") return "low";

  const bc = Number(bookCompleteness) || 0;
  const gf = Number(globalFieldCompleteness) || 0;
  const cc = Number(conflictCount) || 0;
  const rsc =
    requiredScopedCoverage == null ? null : Number(requiredScopedCoverage);

  if (bc >= 0.8 && rsc != null && rsc >= 0.8 && gf >= 0.6 && cc <= 2) {
    return "high";
  }
  if (bc >= 0.5 && (rsc == null || rsc >= 0.5) && gf >= 0.3 && cc <= 5) {
    return "medium";
  }
  return "low";
}

function shellBooksWithReason(canonicalBooksShell, excludedReason) {
  return canonicalBooksShell.map((b) => ({
    ...b,
    pairingContributions: [],
    baseUnitScore: null,
    unitScore: null,
    excludedReason,
  }));
}

function emptyInsufficientAggregation({
  identityFingerprint,
  inputFingerprint,
  tasteVersion,
  tasteFingerprint,
  reasons = [],
  status = "insufficient_scope",
  canonicalBooks = [],
  bookCompleteness = 0,
  requiredScopedCoverage = null,
  globalFieldCompleteness = 0,
  conflictCount = 0,
} = {}) {
  return {
    version: SERIES_AGGREGATION_VERSION,
    identityFingerprint: identityFingerprint || "",
    scopedAssessmentVersion: SCOPED_ASSESSMENT_VERSION,
    inputFingerprint: inputFingerprint || "",
    status,
    policy: { ...SERIES_AGGREGATION_POLICY },
    tasteVersion: tasteVersion || "learned-taste-v1",
    tasteFingerprint: tasteFingerprint || "",
    canonicalBooks,
    baseSeriesScore: null,
    seriesScore: null,
    range: null,
    variation: null,
    bookCompleteness,
    requiredScopedCoverage,
    globalFieldCompleteness,
    conflictCount,
    confidence: "low",
    reasons: [...new Set(reasons)].sort(compareAscii),
  };
}

/**
 * Build the canonical seriesAggregation blob (pure — no disk I/O).
 * When taste is omitted, uses a deterministic neutral profile.
 * Disk-backed taste loading belongs only to attachSeriesAggregation.
 */
export function buildSeriesAggregation({
  research = null,
  analysisMeta = null,
  taste = null,
  scopedCoverage = null,
} = {}) {
  const romance = research?.seriesRomanceIdentity || null;
  const fingerprint = romance ? buildIdentityFingerprint(romance) : null;
  const scoped = analysisMeta?.scopedAssessments || null;
  const globalAssessments = analysisMeta?.assessments || null;
  const profile =
    taste && typeof taste === "object" ? taste : NEUTRAL_TASTE_PROFILE;
  const tasteVersion = profile.version || "learned-taste-v1";
  const tasteFingerprint = buildTasteFingerprint(profile);

  const canonicalBooksShell = buildCanonicalBooksFromIdentity(romance);
  const linkedPairKeys = new Set();
  for (const book of canonicalBooksShell) {
    for (const pk of book.primaryPairingKeys) linkedPairKeys.add(pk);
  }

  let coverage = scopedCoverage;
  if (!coverage && research) {
    try {
      coverage = buildScopedCoverage({ research });
    } catch {
      coverage = null;
    }
  }

  const inputFingerprint = buildSeriesAggregationInputFingerprint({
    canonicalBooks: canonicalBooksShell,
    scopedAssessments: scoped,
    globalAssessments,
    scopedCoverage: coverage,
  });

  const baseEmpty = {
    identityFingerprint: fingerprint,
    inputFingerprint,
    tasteVersion,
    tasteFingerprint,
    globalFieldCompleteness: computeGlobalFieldCompleteness(globalAssessments),
  };

  if (!scoped || typeof scoped !== "object") {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["missing_scoped_assessments"],
      status: "error",
      canonicalBooks: shellBooksWithReason(
        canonicalBooksShell,
        "missing_scoped_assessments"
      ),
    });
  }

  if (
    scoped.version !== SCOPED_ASSESSMENT_VERSION ||
    scoped.promptVersion !== SCOPED_ASSESSMENT_PROMPT_VERSION
  ) {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["stale_scoped_assessment_version"],
      status: "error",
      canonicalBooks: shellBooksWithReason(
        canonicalBooksShell,
        "stale_scoped_assessment_version"
      ),
    });
  }

  if (scoped.identityFingerprint !== fingerprint) {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["identity_fingerprint_mismatch"],
      status: "error",
      canonicalBooks: shellBooksWithReason(
        canonicalBooksShell,
        "identity_fingerprint_mismatch"
      ),
    });
  }

  if (scoped.status === "error") {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["scoped_assessment_error", ...(scoped.reasons || [])],
      status: "error",
      canonicalBooks: shellBooksWithReason(
        canonicalBooksShell,
        "scoped_assessment_error"
      ),
    });
  }

  if (scoped.status !== "ready") {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["scoped_assessments_not_ready", ...(scoped.reasons || [])],
      status: "insufficient_scope",
      canonicalBooks: shellBooksWithReason(
        canonicalBooksShell,
        "scoped_assessments_not_ready"
      ),
      requiredScopedCoverage: computeRequiredScopedCoverage(coverage, linkedPairKeys),
    });
  }

  if (canonicalBooksShell.length === 0) {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["no_canonical_books"],
      status: "insufficient_scope",
      canonicalBooks: [],
      bookCompleteness: 0,
      requiredScopedCoverage: computeRequiredScopedCoverage(coverage, linkedPairKeys),
    });
  }

  const allConflictKeys = new Set();
  const canonicalBooks = [];

  for (const shell of canonicalBooksShell) {
    const pairingContributions = [];

    for (const pairKey of shell.primaryPairingKeys) {
      const built = buildPairingBookContribution({
        bookKey: shell.bookKey,
        semanticPairingKey: pairKey,
        scopedAssessments: scoped,
        globalAssessments,
        taste: profile,
      });
      for (const key of built.conflictEntryKeys || []) allConflictKeys.add(key);
      if (built.contribution) {
        pairingContributions.push(built.contribution);
      }
    }

    pairingContributions.sort((a, b) =>
      compareAscii(a.semanticPairingKey, b.semanticPairingKey)
    );

    const validBase = pairingContributions
      .map((c) => c.baseScore)
      .filter(isFiniteScore);
    const validPersonal = pairingContributions
      .map((c) => c.personalizedScore)
      .filter(isFiniteScore);

    let baseUnitScore = null;
    let unitScore = null;
    let bookExcludedReason = null;
    if (validPersonal.length === 0) {
      bookExcludedReason = "no_valid_primary_contribution";
    } else {
      baseUnitScore = meanRounded(validBase);
      unitScore = meanRounded(validPersonal);
    }

    canonicalBooks.push({
      bookKey: shell.bookKey,
      bookNumber: shell.bookNumber,
      title: shell.title,
      primaryPairingKeys: [...shell.primaryPairingKeys],
      pairingContributions,
      baseUnitScore,
      unitScore,
      excludedReason: bookExcludedReason,
    });
  }

  canonicalBooks.sort((a, b) => compareAscii(a.bookKey, b.bookKey));

  const validBooks = canonicalBooks.filter((b) => isFiniteScore(b.unitScore));
  const bookCompleteness =
    canonicalBooks.length === 0 ? 0 : validBooks.length / canonicalBooks.length;
  const requiredScopedCoverage = computeRequiredScopedCoverage(
    coverage,
    linkedPairKeys
  );
  const globalFieldCompleteness = computeGlobalFieldCompleteness(globalAssessments);
  const conflictCount = allConflictKeys.size;

  if (validBooks.length === 0) {
    return emptyInsufficientAggregation({
      ...baseEmpty,
      reasons: ["no_valid_book_units"],
      status: "insufficient_scope",
      canonicalBooks,
      bookCompleteness,
      requiredScopedCoverage,
      globalFieldCompleteness,
      conflictCount,
    });
  }

  const baseSeriesScore = meanRounded(
    validBooks.map((b) => b.baseUnitScore).filter(isFiniteScore)
  );
  const seriesScore = meanRounded(validBooks.map((b) => b.unitScore));
  const unitScores = validBooks.map((b) => b.unitScore);
  const range = {
    min: Math.min(...unitScores),
    max: Math.max(...unitScores),
  };
  const variation = range.max - range.min;

  const reasons = [];
  if (bookCompleteness < 1) reasons.push("partial_book_coverage");
  if (requiredScopedCoverage != null && requiredScopedCoverage < 1) {
    reasons.push("partial_required_scoped_coverage");
  }
  if (conflictCount > 0) reasons.push("assessment_conflicts_present");

  const status = "ready";
  const confidence = classifyAggregationConfidence({
    bookCompleteness,
    requiredScopedCoverage,
    globalFieldCompleteness,
    conflictCount,
    status,
  });

  return {
    version: SERIES_AGGREGATION_VERSION,
    identityFingerprint: fingerprint || "",
    scopedAssessmentVersion: SCOPED_ASSESSMENT_VERSION,
    inputFingerprint,
    status,
    policy: { ...SERIES_AGGREGATION_POLICY },
    tasteVersion,
    tasteFingerprint,
    canonicalBooks,
    baseSeriesScore,
    seriesScore,
    range,
    variation,
    bookCompleteness,
    requiredScopedCoverage,
    globalFieldCompleteness,
    conflictCount,
    confidence,
    reasons: [...new Set(reasons)].sort(compareAscii),
  };
}

export function canReuseSeriesAggregation(
  existing,
  { identityFingerprint, inputFingerprint, tasteFingerprint } = {}
) {
  if (!existing || typeof existing !== "object") return false;
  if (existing.version !== SERIES_AGGREGATION_VERSION) return false;
  if (existing.identityFingerprint !== identityFingerprint) return false;
  if (existing.inputFingerprint !== inputFingerprint) return false;
  if (existing.tasteFingerprint !== tasteFingerprint) return false;
  if (!AGG_STATUS.includes(existing.status)) return false;
  if (existing.status === "error") return false;
  return true;
}

/**
 * Soft attach: never throws into the pipeline.
 * Inactive paths omit seriesAggregation unless a stale blob must be removed.
 */
export function attachSeriesAggregation({
  research = null,
  analysis = null,
  deps = {},
} = {}) {
  const loadTaste =
    typeof deps.loadLearnedTaste === "function"
      ? deps.loadLearnedTaste
      : loadLearnedTaste;
  const buildCoverage =
    typeof deps.buildScopedCoverage === "function"
      ? deps.buildScopedCoverage
      : buildScopedCoverage;

  if (!analysis || typeof analysis !== "object") {
    return { analysis, changed: false, reused: false, inactive: true };
  }

  const meta = analysis.meta;
  if (!meta || typeof meta !== "object") {
    return { analysis, changed: false, reused: false, inactive: true };
  }

  const romance = research?.seriesRomanceIdentity || null;
  const fingerprint = romance ? buildIdentityFingerprint(romance) : null;
  const planningReady = isRomanceScopePlanningReady(romance);
  const scoped = meta.scopedAssessments;
  const hasScopedReadyShape =
    scoped &&
    typeof scoped === "object" &&
    scoped.version === SCOPED_ASSESSMENT_VERSION &&
    scoped.promptVersion === SCOPED_ASSESSMENT_PROMPT_VERSION &&
    typeof scoped.identityFingerprint === "string" &&
    scoped.identityFingerprint === fingerprint;

  const existingAgg = meta.seriesAggregation || null;

  if (!planningReady || !fingerprint || !hasScopedReadyShape) {
    if (existingAgg) {
      const nextMeta = { ...meta };
      delete nextMeta.seriesAggregation;
      return {
        analysis: { ...analysis, meta: nextMeta },
        changed: true,
        reused: false,
        inactive: true,
      };
    }
    return { analysis, changed: false, reused: false, inactive: true };
  }

  let taste;
  try {
    taste = loadTaste();
  } catch {
    taste = { version: "learned-taste-v1", scoredReviewCount: 0, fieldPrefs: {} };
  }
  const tasteFingerprint = buildTasteFingerprint(taste);

  let coverage = null;
  try {
    coverage = buildCoverage({ research });
  } catch {
    coverage = null;
  }

  const canonicalBooks = buildCanonicalBooksFromIdentity(romance);
  const inputFingerprint = buildSeriesAggregationInputFingerprint({
    canonicalBooks,
    scopedAssessments: scoped,
    globalAssessments: meta.assessments || null,
    scopedCoverage: coverage,
  });

  if (
    canReuseSeriesAggregation(existingAgg, {
      identityFingerprint: fingerprint,
      inputFingerprint,
      tasteFingerprint,
    })
  ) {
    return { analysis, changed: false, reused: true, inactive: false };
  }

  const aggregation = buildSeriesAggregation({
    research,
    analysisMeta: meta,
    taste,
    scopedCoverage: coverage,
  });

  aggregation.inputFingerprint = inputFingerprint;
  aggregation.tasteFingerprint = tasteFingerprint;
  aggregation.identityFingerprint = fingerprint || "";

  const nextMeta = { ...meta, seriesAggregation: aggregation };
  return {
    analysis: { ...analysis, meta: nextMeta },
    changed: true,
    reused: false,
    inactive: false,
    seriesAggregation: aggregation,
  };
}

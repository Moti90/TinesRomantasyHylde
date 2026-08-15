/**
 * C.2.1 field-level evidence / coverage observability.
 * Diagnostic only. Does not change coverage, stop, gap, planner, or retrieval.
 *
 * coverageEligible (job sourceFlow): may potentially count for a targeted field.
 * actuallyCounted: present in collectDirectEvidence as direct or supporting.
 * coverageContributingCount is a deprecated alias of coverageEligibleCount.
 */

import {
  asClaim,
  findSourceById,
  sourceIdentityKey,
} from "./adaptiveResearch.js";
import { findPhenomenonSourceIds } from "./evidenceMapping.js";
import { evaluateEvidenceQualityForField } from "./evidenceQuality.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "./evidenceRelevance.js";
import {
  FIELD_MATCH_ALTERNATIVE_CHARACTER,
  FIELD_MATCH_AMBIGUOUS_SUBJECT,
  FIELD_MATCH_WRONG_SUBJECT,
} from "./sourceSubject.js";
import { classifyDraftEvidence, flowRatio } from "./sourceFlow.js";
import { countSourceRoleMix } from "./fieldResearchNeed.js";

export const NOT_COUNTED_REASONS = {
  DEDUPED_AFTER_JOB: "deduped_after_job",
  NO_FINAL_PHENOMENON_MATCH: "no_final_phenomenon_match",
  SUBJECT_MISMATCH_FINAL: "subject_mismatch_final",
  QUALITY_INELIGIBLE_FINAL: "quality_ineligible_final",
  NOT_LINKED_AND_NO_PHENOMENON_MATCH: "not_linked_and_no_phenomenon_match",
  IDENTITY_SOURCE: "identity_source",
  UNKNOWN: "unknown",
};

const SUBJECT_MISMATCH_REASONS = new Set([
  FIELD_MATCH_WRONG_SUBJECT,
  FIELD_MATCH_ALTERNATIVE_CHARACTER,
  FIELD_MATCH_AMBIGUOUS_SUBJECT,
]);

function unique(arr) {
  return [...new Set((arr || []).filter((v) => v != null && v !== ""))];
}

function coverageOf(cov) {
  return cov?.coverageScore ?? cov?.coverage ?? 0;
}

/**
 * Compact per-field diagnostic snapshot. Copies values; does not mutate coverage.
 */
export function compactFieldSnapshot(coverage) {
  if (!coverage) return null;
  const components = coverage.coverageComponents || {};
  const legacy = coverage.components || {};
  return {
    field: coverage.field,
    score: coverage.score ?? null,
    basis: coverage.basis || null,
    confidence: coverage.confidence || null,

    coverage: coverageOf(coverage),
    stopQualitySatisfied: Boolean(coverage.stopQualitySatisfied),

    directEvidenceCount: Number(coverage.directEvidenceCount) || 0,
    supportingEvidenceCount: Number(coverage.supportingEvidenceCount) || 0,

    directEvidenceSourceIds: [...(coverage.directEvidenceSourceIds || [])],
    supportingEvidenceSourceIds: [...(coverage.supportingEvidenceSourceIds || [])],
    validatedEvidenceSourceIds: [...(coverage.validatedEvidenceSourceIds || [])],
    phenomenonMatchedSourceIds: [...(coverage.phenomenonMatchedSourceIds || [])],
    assessmentEvidenceSourceIds: [...(coverage.assessmentEvidenceSourceIds || [])],

    uniqueDomains: coverage.uniqueDomains ?? coverage.independentDomains ?? 0,
    sourceTypes: [...(coverage.sourceTypes || [])],

    evidencePoints:
      components.directEvidencePoints ?? legacy.directEvidence ?? 0,
    confidenceBasisPoints:
      components.confidenceBasisPoints ?? legacy.confidenceBasis ?? 0,
    independencePoints:
      components.sourceIndependencePoints ?? legacy.sourceIndependence ?? 0,
    specificityPoints:
      components.evidenceSpecificityPoints ?? legacy.evidenceSpecificity ?? 0,
    readerDiversityPoints:
      components.readerDiversityPoints ?? legacy.readerDiversity ?? 0,

    coverageComponents: coverage.coverageComponents
      ? { ...coverage.coverageComponents, capsApplied: [...(components.capsApplied || [])] }
      : null,

    gapReasons: [...(coverage.gapReasons || coverage.reasons || [])],
    supportingSaturated: Boolean(coverage.supportingSaturated),
    supportingMarginalGainPossible: Boolean(coverage.supportingMarginalGainPossible),
    needsStrongDirect: Boolean(coverage.needsStrongDirect),
    sourceRoleMix: coverage.sourceRoleMix ? { ...coverage.sourceRoleMix } : null,
  };
}

export function snapshotsForFields(fields = [], coverage) {
  return (fields || [])
    .map((field) => compactFieldSnapshot(coverage?.fields?.[field]))
    .filter(Boolean);
}

function identityKeyOf(source, fallbackId) {
  return sourceIdentityKey(source) || fallbackId || "";
}

function countedIdentityKeys(coverage, research) {
  const ids = unique([
    ...(coverage?.directEvidenceSourceIds || []),
    ...(coverage?.supportingEvidenceSourceIds || []),
  ]);
  const keys = new Set();
  for (const id of ids) {
    const src = findSourceById(research, id);
    const key = identityKeyOf(src, id);
    if (key) keys.add(key);
  }
  return keys;
}

function eligibleKeysForField(jobs, field) {
  const keys = new Set();
  for (const job of jobs || []) {
    const flow = job?.sourceFlow || job || {};
    const byField = flow.keySets?.coverageEligibleByField?.[field] || [];
    if (byField.length) {
      for (const key of byField) {
        if (key) keys.add(key);
      }
      continue;
    }
    const targets = job?.targetFields || job?.fields || [];
    if (targets.includes(field)) {
      for (const key of flow.keySets?.coverageEligible || []) {
        if (key) keys.add(key);
      }
    }
  }
  return keys;
}

function sourceByIdentity(research, key) {
  if (!key) return null;
  return (research?.sources || []).find((s) => sourceIdentityKey(s) === key) || null;
}

function existingKeySet(research) {
  const keys = new Set();
  for (const s of research?.sources || []) {
    const key = sourceIdentityKey(s);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Explain why a job-eligible source is absent from counted direct/supporting.
 * Replays existing runtime checks. Does not add filters.
 */
export function diagnoseEligibleNotCounted({
  source,
  field,
  research,
  assessment,
  identity,
  leadCharacters,
  existingIdentityKeys,
} = {}) {
  if (!source) return NOT_COUNTED_REASONS.UNKNOWN;
  if (source.purpose === "identity") return NOT_COUNTED_REASONS.IDENTITY_SOURCE;

  const key = sourceIdentityKey(source);
  const inResearch =
    sourceByIdentity(research, key) || findSourceById(research, source.id);

  if (inResearch?.purpose === "identity") {
    return NOT_COUNTED_REASONS.IDENTITY_SOURCE;
  }

  if (!inResearch) {
    if (key && existingIdentityKeys instanceof Set && existingIdentityKeys.has(key)) {
      return NOT_COUNTED_REASONS.DEDUPED_AFTER_JOB;
    }
    return NOT_COUNTED_REASONS.UNKNOWN;
  }

  const claim = asClaim(field, assessment);
  const linked = new Set([
    ...(claim.evidenceSourceIds || []),
    ...(claim.conflictingSourceIds || []),
  ]);
  const phenomenonIds = new Set(findPhenomenonSourceIds(field, research) || []);
  const isLinked = linked.has(inResearch.id);
  const inPhenomenon = phenomenonIds.has(inResearch.id);

  if (!isLinked && !inPhenomenon) {
    return NOT_COUNTED_REASONS.NOT_LINKED_AND_NO_PHENOMENON_MATCH;
  }

  const subjectContext = {
    research,
    identity,
    leadCharacters: leadCharacters || research?.seriesIdentity,
  };
  const evaluation = evaluateSourceForField({
    source: inResearch,
    field,
    assessment: claim,
    context: subjectContext,
  });

  if (!isFieldSpecificEvidence(evaluation)) {
    if (SUBJECT_MISMATCH_REASONS.has(evaluation?.subjectRejectionReason)) {
      return NOT_COUNTED_REASONS.SUBJECT_MISMATCH_FINAL;
    }
    return NOT_COUNTED_REASONS.NO_FINAL_PHENOMENON_MATCH;
  }

  const quality = evaluateEvidenceQualityForField({
    source: inResearch,
    field,
    relevance: evaluation.relevance,
  });
  if (quality.reason === "identity_only" || inResearch.purpose === "identity") {
    return NOT_COUNTED_REASONS.IDENTITY_SOURCE;
  }
  if (!quality.eligible || !["direct", "supporting"].includes(quality.coverageBucket)) {
    return NOT_COUNTED_REASONS.QUALITY_INELIGIBLE_FINAL;
  }

  return NOT_COUNTED_REASONS.UNKNOWN;
}

function eligibleSourceRecords(jobs, field, research) {
  const keys = eligibleKeysForField(jobs, field);
  const records = [];
  for (const key of keys) {
    const fromResearch = sourceByIdentity(research, key);
    records.push({
      key,
      source: fromResearch || { url: key, id: key },
      sourceId: fromResearch?.id || null,
    });
  }
  return records;
}

export function compareEligibleVsCounted({
  field,
  jobs = [],
  coverage,
  research,
  assessment,
  identity,
  leadCharacters,
  researchBefore,
} = {}) {
  const eligibleRecords = eligibleSourceRecords(jobs, field, research);
  const countedKeys = countedIdentityKeys(coverage, research);
  const eligibleSourceIds = unique(
    eligibleRecords.map((r) => r.sourceId || r.key)
  );
  const countedDirectSourceIds = [...(coverage?.directEvidenceSourceIds || [])];
  const countedSupportingSourceIds = [
    ...(coverage?.supportingEvidenceSourceIds || []),
  ];
  const existingIdentityKeys = existingKeySet(researchBefore || {});
  const eligibleButNotCounted = [];
  let actuallyCounted = 0;

  for (const row of eligibleRecords) {
    if (countedKeys.has(row.key)) {
      actuallyCounted += 1;
      continue;
    }
    eligibleButNotCounted.push({
      sourceId: row.sourceId,
      identityKey: row.key,
      reason: diagnoseEligibleNotCounted({
        source: row.source,
        field,
        research,
        assessment,
        identity,
        leadCharacters,
        existingIdentityKeys,
      }),
    });
  }

  return {
    field,
    eligibleSourceIds,
    countedDirectSourceIds,
    countedSupportingSourceIds,
    eligibleCount: eligibleRecords.length,
    actuallyCountedCount: actuallyCounted,
    eligibleButNotCounted,
  };
}

function arrow(before, after) {
  return `${before}→${after}`;
}

export function compactRoundFieldRow({
  field,
  before,
  after,
  eligibleVsCounted,
} = {}) {
  const b = before || {};
  const a = after || {};
  return {
    field,
    coverage: arrow(coverageOf(b), coverageOf(a)),
    direct: arrow(b.directEvidenceCount || 0, a.directEvidenceCount || 0),
    supporting: arrow(
      b.supportingEvidenceCount || 0,
      a.supportingEvidenceCount || 0
    ),
    eligibleThisRound: eligibleVsCounted?.eligibleCount ?? 0,
    actuallyCountedThisRound: eligibleVsCounted?.actuallyCountedCount ?? 0,
    supportingSaturated: Boolean(a.supportingSaturated),
    stopQuality: arrow(
      Boolean(b.stopQualitySatisfied),
      Boolean(a.stopQualitySatisfied)
    ),
    gapReasonsAfter: [...(a.gapReasons || [])],
  };
}

/**
 * Round-level field coverage diagnostics. Pure; does not mutate coverage objects.
 */
export function buildRoundFieldCoverageObservability({
  targetFields = [],
  coverageBefore,
  coverageAfter,
  jobs = [],
  researchAfter,
  researchBefore,
  identity,
  assessments,
} = {}) {
  const fields = unique(targetFields);
  const fieldSnapshotsBefore = snapshotsForFields(fields, coverageBefore);
  const fieldSnapshotsAfter = snapshotsForFields(fields, coverageAfter);
  const afterByField = Object.fromEntries(
    fieldSnapshotsAfter.map((s) => [s.field, s])
  );
  const beforeByField = Object.fromEntries(
    fieldSnapshotsBefore.map((s) => [s.field, s])
  );

  const fieldRows = fields.map((field) => {
    const afterSnap = afterByField[field];
    const beforeSnap = beforeByField[field];
    const eligibleVsCounted = compareEligibleVsCounted({
      field,
      jobs,
      coverage: coverageAfter?.fields?.[field] || afterSnap,
      research: researchAfter,
      assessment: assessments?.[field],
      identity,
      leadCharacters: researchAfter?.seriesIdentity,
      researchBefore,
    });
    return {
      ...compactRoundFieldRow({
        field,
        before: beforeSnap,
        after: afterSnap,
        eligibleVsCounted,
      }),
      eligibleVsCounted,
    };
  });

  const weightedBefore = Number(coverageBefore?.weightedCoverage) || 0;
  const weightedAfter = Number(coverageAfter?.weightedCoverage) || 0;

  return {
    fieldSnapshotsBefore,
    fieldSnapshotsAfter,
    fieldCoverageSummary: {
      targets: fields,
      weightedCoverageBefore: weightedBefore,
      weightedCoverageAfter: weightedAfter,
      weightedDelta: Math.round((weightedAfter - weightedBefore) * 100) / 100,
      fields: fieldRows.map((row) => {
        const { eligibleVsCounted: _evc, ...compact } = row;
        return compact;
      }),
    },
    fieldEligibleVsCounted: fieldRows.map((row) => row.eligibleVsCounted),
  };
}

export function summarizeFieldFlow({
  rounds = [],
  coverage,
} = {}) {
  const targeted = new Set();
  const eligibleKeys = new Set();
  const countedEligibleKeys = new Set();
  let eligibleEvents = 0;
  let countedEvents = 0;

  for (const round of rounds || []) {
    const summary = round.fieldCoverageSummary || {};
    for (const field of summary.targets || round.targetFields || []) {
      targeted.add(field);
    }
    const compared = round.fieldEligibleVsCounted || [];
    if (compared.length) {
      for (const row of compared) {
        eligibleEvents += Number(row.eligibleCount) || 0;
        countedEvents += Number(row.actuallyCountedCount) || 0;
        for (const id of row.eligibleSourceIds || []) eligibleKeys.add(id);
        const countedIds = new Set([
          ...(row.countedDirectSourceIds || []),
          ...(row.countedSupportingSourceIds || []),
        ]);
        for (const id of row.eligibleSourceIds || []) {
          if (countedIds.has(id)) countedEligibleKeys.add(id);
        }
      }
      continue;
    }
    for (const row of summary.fields || []) {
      eligibleEvents += Number(row.eligibleThisRound) || 0;
      countedEvents += Number(row.actuallyCountedThisRound) || 0;
    }
  }

  let saturatedSupportingFieldCount = 0;
  let strongDirectDeficitFieldCount = 0;
  const fieldReview = [];
  for (const [field, cov] of Object.entries(coverage?.fields || {})) {
    if (cov.supportingSaturated) saturatedSupportingFieldCount += 1;
    if (cov.needsStrongDirect) strongDirectDeficitFieldCount += 1;
    if (!targeted.size || targeted.has(field)) {
      fieldReview.push({
        field,
        coverage: cov.coverageScore,
        direct: cov.directEvidenceCount || 0,
        supporting: cov.supportingEvidenceCount || 0,
        supportingSaturated: Boolean(cov.supportingSaturated),
        needsStrongDirect: Boolean(cov.needsStrongDirect),
        stopQualitySatisfied: Boolean(cov.stopQualitySatisfied),
        sourceRoleMix: cov.sourceRoleMix || null,
      });
    }
  }

  const eligibleEvidenceCount = eligibleKeys.size || eligibleEvents;
  const actuallyCountedEvidenceCount =
    countedEligibleKeys.size || countedEvents;

  return {
    targetedFieldsCount: targeted.size,
    eligibleEvidenceCount,
    actuallyCountedEvidenceCount,
    eligibleToCountedRate: flowRatio(
      actuallyCountedEvidenceCount,
      eligibleEvidenceCount
    ),
    saturatedSupportingFieldCount,
    strongDirectDeficitFieldCount,
    fields: fieldReview,
  };
}

export function observePreparedSourceMix({
  prepared = [],
  targetFields = [],
  context = {},
  requestedRetrievalMode = "general",
  preferredSourceRoles = [],
} = {}) {
  const fieldRelevant = [];
  const eligible = [];
  for (const source of prepared || []) {
    const classified = classifyDraftEvidence(source, {
      targetFields,
      context,
    });
    if (classified.fieldRelevant) fieldRelevant.push(source);
    if (classified.coverageEligible) eligible.push(source);
  }
  return {
    requestedRetrievalMode: requestedRetrievalMode || "general",
    preferredSourceRoles: [...(preferredSourceRoles || [])],
    returnedRoleMix: countSourceRoleMix(prepared),
    fieldRelevantRoleMix: countSourceRoleMix(fieldRelevant),
    coverageEligibleRoleMix: countSourceRoleMix(eligible),
  };
}

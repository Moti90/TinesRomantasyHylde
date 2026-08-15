/**
 * C.1.2 source-flow observability.
 * Diagnostic only. Does not change retention, scoring, or search.
 * Source of truth: evaluateSourceForField, sourceSubject, evaluateEvidenceQualityForField.
 *
 * coverageEligible (C.1.3): subject-valid field-specific evidence whose
 * source role is suitable for that field class. This is no longer the
 * global subjectiveSourceQuality >= 0.5 gate. Usable study-guide/fandom
 * behavior evidence can be coverageEligible (as supporting-equivalent).
 *
 * coverageEligible means "may potentially count" — not "actually counted"
 * in collectDirectEvidence (direct/supporting). coverageContributingCount
 * is a deprecated alias of coverageEligibleCount (C.2.1).
 */

import {
  sourceIdentityKey,
  subjectiveSourceQuality,
} from "./adaptiveResearch.js";
import {
  evaluateEvidenceQualityForField,
  bestQualityTier,
} from "./evidenceQuality.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
  classifySourceRole,
} from "./evidenceRelevance.js";
import {
  FIELD_MATCH_ALTERNATIVE_CHARACTER,
  FIELD_MATCH_AMBIGUOUS_SUBJECT,
  FIELD_MATCH_WRONG_SUBJECT,
} from "./sourceSubject.js";
import {
  classifySourceType,
  isIndustryNoise,
  isPublisherPr,
} from "./webResearch.js";

export const SOURCE_FLOW_CRITICAL_FIELDS = [
  "Touch her and die-vibe (0-5)",
  "Rhysand-faktoren",
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Kvindelig udvikling (0-5)",
];

const WRONG_SUBJECT_REASONS = new Set([
  FIELD_MATCH_WRONG_SUBJECT,
  FIELD_MATCH_ALTERNATIVE_CHARACTER,
]);

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function asDraft(value) {
  if (!value) return null;
  if (typeof value === "string") return { url: value };
  return value;
}

export function draftIdentityKey(draft) {
  const row = asDraft(draft);
  if (!row) return "";
  return sourceIdentityKey({ url: row.url, id: row.id || row.title });
}

function uniqueDrafts(drafts = []) {
  const seen = new Set();
  const out = [];
  for (const d of drafts || []) {
    const row = asDraft(d);
    if (!row) continue;
    const key = draftIdentityKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function emptyDropReasons() {
  return {
    focusRejected: 0,
    cappedBeforePrepare: 0,
    prepareRejected: 0,
    fieldIrrelevant: 0,
    wrongSubject: 0,
    ambiguousSubject: 0,
    lowCoverageQuality: 0,
    lowFieldQuality: 0,
    readerExperienceWrongRole: 0,
    studyGuideDemoted: 0,
    identityOnly: 0,
    genericClaim: 0,
    duplicate: 0,
  };
}

export function emptyPrepareDropReasons() {
  return {
    catalog: 0,
    publisher_pr: 0,
    duplicate: 0,
    cap: 0,
    invalid_url: 0,
    other: 0,
  };
}

export function emptyFocusRejectedByReason() {
  return {
    redditHeuristic: 0,
    catalog: 0,
    wikipedia: 0,
    wikiLore: 0,
    other: 0,
  };
}

export function emptyCriticalFieldFlow() {
  return Object.fromEntries(
    SOURCE_FLOW_CRITICAL_FIELDS.map((field) => [
      field,
      { fieldRelevant: 0, subjectValid: 0, coverageEligible: 0 },
    ])
  );
}

export function emptySourceFlow() {
  return {
    rawUrlCount: 0,
    modelFindingCount: 0,
    mergedBeforeCapCount: 0,
    returnedFindingCount: 0,
    mergedCount: 0,
    preparedCount: 0,
    fieldRelevantCount: 0,
    subjectValidCount: 0,
    coverageEligibleCount: 0,
    /** @deprecated alias of coverageEligibleCount — not actually-counted. */
    coverageContributingCount: 0,
    qualityStrongCount: 0,
    qualityUsableCount: 0,
    qualityWeakCount: 0,
    qualityIneligibleCount: 0,
    newUniqueCount: 0,
    cappedCount: 0,
    cappedFieldRelevantCount: 0,
    dropReasons: emptyDropReasons(),
    focusRejectedByReason: emptyFocusRejectedByReason(),
    prepareDropReasons: emptyPrepareDropReasons(),
    criticalFieldFlow: emptyCriticalFieldFlow(),
  };
}

export function flowRatio(numerator, denominator) {
  const den = Number(denominator) || 0;
  if (!den) return null;
  return Math.round((Number(numerator) / den) * 10000) / 10000;
}

/**
 * Same keep/drop order as prepareFollowUpSources / prepareIdentitySources.
 * Returns null when the draft should be kept.
 */
export function classifyPrepareRejection(draft, { seen, skipCatalogPr = false } = {}) {
  const f = asDraft(draft) || {};
  if (!f.url && !f.title) return "invalid_url";
  const type = classifySourceType(f.url, f.title, f.type);
  if (!skipCatalogPr && ["catalog", "official", "publisher"].includes(type)) {
    return "catalog";
  }
  if (isIndustryNoise(f.url, f.title)) return "other";
  if (!skipCatalogPr && isPublisherPr(f.url, f.title)) return "publisher_pr";
  const key = sourceIdentityKey({ url: f.url, id: f.title });
  if (key && seen instanceof Set && seen.has(key)) return "duplicate";
  return null;
}

export function diagnosePrepareDrops(findings, { cap, skipCatalogPr = false } = {}) {
  const reasons = emptyPrepareDropReasons();
  const seen = new Set();
  let kept = 0;
  const limit = Math.max(1, Number(cap) || 8);
  const list = findings || [];
  for (let i = 0; i < list.length; i++) {
    if (kept >= limit) {
      reasons.cap += list.length - i;
      break;
    }
    const reason = classifyPrepareRejection(list[i], { seen, skipCatalogPr });
    if (reason) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      continue;
    }
    const f = asDraft(list[i]) || {};
    const key = sourceIdentityKey({ url: f.url, id: f.title });
    if (key) seen.add(key);
    kept += 1;
  }
  return reasons;
}

export function countFocusRejectedByReason(droppedFocus = []) {
  const byReason = emptyFocusRejectedByReason();
  for (const row of droppedFocus || []) {
    const reason = row?.reason && byReason[row.reason] != null ? row.reason : "other";
    byReason[reason] += 1;
  }
  return byReason;
}

function isRawFieldSpecific(evaluation) {
  return ["direct", "supporting"].includes(evaluation?.rawRelevance);
}

function subjectDropBucket(evaluation) {
  const reason = evaluation?.subjectRejectionReason;
  if (WRONG_SUBJECT_REASONS.has(reason)) return "wrongSubject";
  if (reason === FIELD_MATCH_AMBIGUOUS_SUBJECT) return "ambiguousSubject";
  if (isRawFieldSpecific(evaluation) && !isFieldSpecificEvidence(evaluation)) {
    return reason === FIELD_MATCH_AMBIGUOUS_SUBJECT
      ? "ambiguousSubject"
      : "wrongSubject";
  }
  return null;
}

export function classifyDraftEvidence(source, { targetFields = [], context = {} } = {}) {
  const fields = unique(targetFields);
  const criticalFieldFlow = emptyCriticalFieldFlow();
  let fieldRelevant = false;
  let subjectValid = false;
  let coverageEligible = false;
  let wrongSubject = false;
  let ambiguousSubject = false;
  const fieldRows = [];
  const qualityTiers = [];
  const qualityReasons = [];

  for (const field of fields) {
    const ev = evaluateSourceForField({ source, field, context });
    const raw = isRawFieldSpecific(ev);
    const valid = isFieldSpecificEvidence(ev);
    const quality = evaluateEvidenceQualityForField({
      source,
      field,
      relevance: ev.relevance,
    });
    const eligible = valid && quality.eligible;
    qualityReasons.push(quality.reason);
    if (raw) fieldRelevant = true;
    if (valid) {
      subjectValid = true;
      qualityTiers.push(quality.qualityTier);
    }
    if (eligible) coverageEligible = true;
    const bucket = subjectDropBucket(ev);
    if (bucket === "wrongSubject") wrongSubject = true;
    if (bucket === "ambiguousSubject") ambiguousSubject = true;
    if (criticalFieldFlow[field]) {
      if (raw) criticalFieldFlow[field].fieldRelevant = 1;
      if (valid) criticalFieldFlow[field].subjectValid = 1;
      if (eligible) criticalFieldFlow[field].coverageEligible = 1;
    }
    fieldRows.push({
      field,
      rawRelevance: ev.rawRelevance || ev.relevance,
      validatedRelevance: ev.validatedRelevance || ev.relevance,
      subjectStatus: ev.subject?.subjectStatus || null,
      subjectRejectionReason: ev.subjectRejectionReason || null,
      coverageEligible: eligible,
      qualityTier: quality.qualityTier,
      qualityReason: quality.reason,
      fieldClass: quality.fieldClass,
      coverageBucket: quality.coverageBucket,
    });
  }

  const qualityTier = subjectValid
    ? bestQualityTier(qualityTiers)
    : "ineligible";
  const qualityReason =
    qualityReasons.find((r) => r === "identity_only") ||
    qualityReasons.find((r) => r === "reader_experience_wrong_role") ||
    qualityReasons.find((r) => r === "study_guide_demoted") ||
    qualityReasons.find((r) => r === "generic_claim") ||
    qualityReasons.find((r) => r && r !== "not_field_specific") ||
    qualityReasons.find((r) => r) ||
    null;

  return {
    fieldRelevant,
    subjectValid,
    coverageEligible,
    coverageContributing: coverageEligible,
    wrongSubject,
    ambiguousSubject,
    fieldIrrelevant: fields.length ? !fieldRelevant : true,
    quality: source ? subjectiveSourceQuality(source) : 0,
    qualityTier,
    qualityReason,
    role: source ? classifySourceRole(source) : null,
    criticalFieldFlow,
    fieldRows,
  };
}

function existingKeySet(existingSources = []) {
  const keys = new Set();
  for (const s of existingSources || []) {
    const key = draftIdentityKey(s);
    if (key) keys.add(key);
  }
  return keys;
}

function debugSourceRow(source, classified, { dropStage = null, dropReason = null } = {}) {
  return {
    url: source?.url || null,
    role: classified.role,
    quality: classified.quality,
    qualityTier: classified.qualityTier,
    rawRelevance: classified.fieldRelevant,
    subjectStatus: classified.fieldRows[0]?.subjectStatus || null,
    validatedRelevance: classified.subjectValid,
    coverageEligible: classified.coverageEligible,
    dropStage,
    dropReason,
  };
}

function applyClassifiedSource(flow, classified, key, keySets) {
  if (classified.fieldRelevant) {
    flow.fieldRelevantCount += 1;
    if (key) keySets.fieldRelevant.push(key);
  } else {
    flow.dropReasons.fieldIrrelevant += 1;
    if (classified.qualityReason === "generic_claim") {
      flow.dropReasons.genericClaim += 1;
    }
  }
  if (classified.subjectValid) {
    flow.subjectValidCount += 1;
    if (key) keySets.subjectValid.push(key);
  }
  if (classified.coverageEligible) {
    flow.coverageEligibleCount += 1;
    flow.coverageContributingCount += 1;
    if (key) keySets.coverageEligible.push(key);
  }
  if (classified.fieldRelevant && !classified.subjectValid) {
    if (classified.ambiguousSubject && !classified.wrongSubject) {
      flow.dropReasons.ambiguousSubject += 1;
    } else {
      flow.dropReasons.wrongSubject += 1;
    }
  }
  if (classified.subjectValid) {
    if (classified.qualityTier === "strong") flow.qualityStrongCount += 1;
    else if (classified.qualityTier === "usable") flow.qualityUsableCount += 1;
    else if (classified.qualityTier === "weak") flow.qualityWeakCount += 1;
    else flow.qualityIneligibleCount += 1;
  }
  if (classified.subjectValid && !classified.coverageEligible) {
    flow.dropReasons.lowCoverageQuality += 1;
    flow.dropReasons.lowFieldQuality += 1;
    if (classified.qualityReason === "reader_experience_wrong_role") {
      flow.dropReasons.readerExperienceWrongRole += 1;
    }
    if (classified.qualityReason === "identity_only") {
      flow.dropReasons.identityOnly += 1;
    }
    if (classified.qualityReason === "generic_claim") {
      flow.dropReasons.genericClaim += 1;
    }
  }
  if (
    classified.coverageEligible &&
    classified.fieldRows.some((row) => row.qualityReason === "study_guide_demoted")
  ) {
    flow.dropReasons.studyGuideDemoted += 1;
  }
}

function classifiedDropMeta(classified) {
  if (classified.coverageEligible) {
    return { dropStage: null, dropReason: null };
  }
  if (classified.subjectValid) {
    return {
      dropStage: "coverage_quality",
      dropReason: classified.qualityReason || "lowCoverageQuality",
    };
  }
  if (classified.fieldRelevant) {
    return {
      dropStage: "subject",
      dropReason: classified.wrongSubject
        ? "wrongSubject"
        : classified.ambiguousSubject
          ? "ambiguousSubject"
          : "wrongSubject",
    };
  }
  return { dropStage: "field", dropReason: "fieldIrrelevant" };
}

/**
 * Build per-job sourceFlow. Field/subject/coverage are unique sources,
 * not field-hits. A source matching two fields still counts as 1.
 */
export function buildJobSourceFlow({
  rawUrls = [],
  modelFindingCount = 0,
  mergedDraftsBeforeCap = [],
  returnedFindings = [],
  prepared = [],
  cappedDrafts = [],
  droppedFocus = [],
  prepareDropReasons = null,
  existingSources = [],
  targetFields = [],
  context = {},
  includeSourceDetails = false,
} = {}) {
  const flow = emptySourceFlow();
  const rawUnique = uniqueDrafts(rawUrls);
  const beforeCap = uniqueDrafts(mergedDraftsBeforeCap);
  const returned = uniqueDrafts(returnedFindings);
  const preparedDrafts = uniqueDrafts(prepared);
  const returnedKeys = new Set(returned.map(draftIdentityKey).filter(Boolean));
  const cappedOnly = uniqueDrafts(cappedDrafts).filter((d) => {
    const key = draftIdentityKey(d);
    return key && !returnedKeys.has(key);
  });
  const existing = existingKeySet(existingSources);
  const fields = unique(targetFields);
  const focusByReason = countFocusRejectedByReason(droppedFocus);

  flow.rawUrlCount = rawUnique.length;
  flow.modelFindingCount = Number(modelFindingCount) || 0;
  flow.mergedBeforeCapCount = beforeCap.length;
  flow.returnedFindingCount = returned.length;
  flow.mergedCount = returned.length;
  flow.preparedCount = preparedDrafts.length;
  flow.cappedCount = cappedOnly.length;
  flow.dropReasons.focusRejected = (droppedFocus || []).length;
  flow.dropReasons.cappedBeforePrepare = cappedOnly.length;
  flow.focusRejectedByReason = focusByReason;
  flow.prepareDropReasons = prepareDropReasons || emptyPrepareDropReasons();
  flow.dropReasons.prepareRejected =
    (flow.prepareDropReasons.catalog || 0) +
    (flow.prepareDropReasons.publisher_pr || 0) +
    (flow.prepareDropReasons.invalid_url || 0) +
    (flow.prepareDropReasons.other || 0);
  flow.dropReasons.duplicate = flow.prepareDropReasons.duplicate || 0;

  const details = [];
  const keySets = {
    raw: rawUnique.map(draftIdentityKey).filter(Boolean),
    returned: returned.map(draftIdentityKey).filter(Boolean),
    prepared: [],
    newUnique: [],
    fieldRelevant: [],
    subjectValid: [],
    coverageEligible: [],
    coverageEligibleByField: Object.fromEntries(fields.map((f) => [f, []])),
  };
  for (const source of preparedDrafts) {
    const key = draftIdentityKey(source);
    if (key) keySets.prepared.push(key);
    const classified = classifyDraftEvidence(source, { targetFields: fields, context });
    if (key && !existing.has(key)) {
      flow.newUniqueCount += 1;
      keySets.newUnique.push(key);
    }
    applyClassifiedSource(flow, classified, key, keySets);
    if (key) {
      for (const row of classified.fieldRows || []) {
        if (!row.coverageEligible) continue;
        if (!keySets.coverageEligibleByField[row.field]) {
          keySets.coverageEligibleByField[row.field] = [];
        }
        keySets.coverageEligibleByField[row.field].push(key);
      }
    }
    for (const field of SOURCE_FLOW_CRITICAL_FIELDS) {
      const row = classified.criticalFieldFlow[field];
      if (!row) continue;
      flow.criticalFieldFlow[field].fieldRelevant += row.fieldRelevant;
      flow.criticalFieldFlow[field].subjectValid += row.subjectValid;
      flow.criticalFieldFlow[field].coverageEligible += row.coverageEligible;
    }
    if (includeSourceDetails) {
      details.push(debugSourceRow(source, classified, classifiedDropMeta(classified)));
    }
  }

  for (const draft of cappedOnly) {
    const classified = classifyDraftEvidence(draft, { targetFields: fields, context });
    if (classified.fieldRelevant) flow.cappedFieldRelevantCount += 1;
    if (includeSourceDetails) {
      details.push(
        debugSourceRow(draft, classified, {
          dropStage: "cap",
          dropReason: "cappedBeforePrepare",
        })
      );
    }
  }

  if (includeSourceDetails) flow.sourceDetails = details;
  flow.keySets = keySets;
  return flow;
}

export function mergeAttemptObservability(primary = {}, fallback = {}) {
  const droppedFocus = [
    ...(primary.droppedFocus || []),
    ...(fallback.droppedFocus || []),
  ];
  const mergedDraftsBeforeCap = uniqueDrafts([
    ...(primary.mergedDraftsBeforeCap || []),
    ...(fallback.mergedDraftsBeforeCap || []),
  ]);
  const returned = uniqueDrafts([
    ...(primary.findings || []),
    ...(fallback.findings || []),
  ]);
  const returnedKeys = new Set(returned.map(draftIdentityKey).filter(Boolean));
  const cappedDrafts = uniqueDrafts([
    ...(primary.cappedDrafts || []),
    ...(fallback.cappedDrafts || []),
  ]).filter((d) => {
    const key = draftIdentityKey(d);
    return key && !returnedKeys.has(key);
  });
  const modelFindingCount =
    (Number(primary.modelFindingCount) || 0) +
    (Number(fallback.modelFindingCount) || 0);
  return {
    droppedFocus,
    mergedDraftsBeforeCap,
    cappedDrafts,
    modelFindingCount,
    mergedBeforeCapCount: mergedDraftsBeforeCap.length,
    returnedFindingCount: returned.length,
    cappedCount: cappedDrafts.length,
  };
}

/**
 * Subject-rejection numerator for SUBJECT_REJECTION_HEAVY.
 * Same population as fieldRelevant / subjectValid — never larger than fieldRelevant.
 */
export function subjectRejectedCount(fieldRelevant, subjectValid) {
  const relevant = Math.max(0, Number(fieldRelevant) || 0);
  const valid = Math.max(0, Number(subjectValid) || 0);
  return Math.max(0, relevant - valid);
}

/**
 * Canonical-unique round aggregate.
 * Job-sum fields that can double-count are not used; prepared/field/subject
 * counts are unique identities across jobs.
 */
export function aggregateRoundSourceFlow(jobFlows = []) {
  const empty = {
    jobs: jobFlows.length,
    rawUrls: 0,
    returnedFindings: 0,
    prepared: 0,
    newUnique: 0,
    fieldRelevant: 0,
    subjectValid: 0,
    coverageEligible: 0,
    coverageContributing: 0, // deprecated alias of coverageEligible
    qualityStrong: 0,
    qualityUsable: 0,
    qualityWeak: 0,
    qualityIneligible: 0,
    cappedFieldRelevantCount: 0,
    wrongSubjectRejectedCount: 0,
    adaptiveJobSubjectRejectedCount: 0,
    lowCoverageQualityCount: 0,
    focusRejected: 0,
    unique: true,
  };
  const keys = {
    raw: new Set(),
    returned: new Set(),
    prepared: new Set(),
    newUnique: new Set(),
    fieldRelevant: new Set(),
    subjectValid: new Set(),
    coverageEligible: new Set(),
  };
  let cappedFieldRelevantCount = 0;
  let lowCoverageQualityCount = 0;
  let focusRejected = 0;
  let rawSum = 0;
  let returnedSum = 0;
  let qualityStrong = 0;
  let qualityUsable = 0;
  let qualityWeak = 0;
  let qualityIneligible = 0;

  for (const job of jobFlows || []) {
    const flow = job?.sourceFlow || job;
    rawSum += Number(flow.rawUrlCount) || 0;
    returnedSum += Number(flow.returnedFindingCount ?? flow.mergedCount) || 0;
    cappedFieldRelevantCount += Number(flow.cappedFieldRelevantCount) || 0;
    lowCoverageQualityCount += Number(flow.dropReasons?.lowCoverageQuality) || 0;
    focusRejected += Number(flow.dropReasons?.focusRejected) || 0;
    qualityStrong += Number(flow.qualityStrongCount) || 0;
    qualityUsable += Number(flow.qualityUsableCount) || 0;
    qualityWeak += Number(flow.qualityWeakCount) || 0;
    qualityIneligible += Number(flow.qualityIneligibleCount) || 0;
    for (const key of flow.keySets?.raw || []) keys.raw.add(key);
    for (const key of flow.keySets?.returned || []) keys.returned.add(key);
    for (const key of flow.keySets?.prepared || []) keys.prepared.add(key);
    for (const key of flow.keySets?.newUnique || []) keys.newUnique.add(key);
    for (const key of flow.keySets?.fieldRelevant || []) keys.fieldRelevant.add(key);
    for (const key of flow.keySets?.subjectValid || []) keys.subjectValid.add(key);
    for (const key of flow.keySets?.coverageEligible || []) {
      keys.coverageEligible.add(key);
    }
  }

  const quality = {
    qualityStrong,
    qualityUsable,
    qualityWeak,
    qualityIneligible,
  };

  const hasKeySets = jobFlows.some((j) => j?.sourceFlow?.keySets || j?.keySets);
  if (hasKeySets) {
    const fieldRelevant = keys.fieldRelevant.size;
    const subjectValid = keys.subjectValid.size;
    return {
      ...empty,
      ...quality,
      rawUrls: keys.raw.size || rawSum,
      returnedFindings: keys.returned.size || returnedSum,
      prepared: keys.prepared.size,
      newUnique: keys.newUnique.size,
      fieldRelevant,
      subjectValid,
      coverageEligible: keys.coverageEligible.size,
      coverageContributing: keys.coverageEligible.size,
      cappedFieldRelevantCount,
      wrongSubjectRejectedCount: subjectRejectedCount(fieldRelevant, subjectValid),
      adaptiveJobSubjectRejectedCount: subjectRejectedCount(fieldRelevant, subjectValid),
      lowCoverageQualityCount,
      focusRejected,
      unique: true,
    };
  }

  const fieldRelevant = jobFlows.reduce(
    (n, j) => n + (Number((j.sourceFlow || j).fieldRelevantCount) || 0),
    0
  );
  const subjectValid = jobFlows.reduce(
    (n, j) => n + (Number((j.sourceFlow || j).subjectValidCount) || 0),
    0
  );
  const coverageEligible = jobFlows.reduce(
    (n, j) => n + (Number((j.sourceFlow || j).coverageEligibleCount) || 0),
    0
  );
  return {
    ...empty,
    ...quality,
    rawUrls: rawSum,
    returnedFindings: returnedSum,
    prepared: jobFlows.reduce(
      (n, j) => n + (Number((j.sourceFlow || j).preparedCount) || 0),
      0
    ),
    newUnique: jobFlows.reduce(
      (n, j) => n + (Number((j.sourceFlow || j).newUniqueCount) || 0),
      0
    ),
    fieldRelevant,
    subjectValid,
    coverageEligible,
    coverageContributing: coverageEligible,
    cappedFieldRelevantCount,
    wrongSubjectRejectedCount: subjectRejectedCount(fieldRelevant, subjectValid),
    adaptiveJobSubjectRejectedCount: subjectRejectedCount(fieldRelevant, subjectValid),
    lowCoverageQualityCount,
    focusRejected,
    unique: false,
    note: "job-sum; may include cross-job duplicates when keySets are absent",
  };
}

export function attachFlowKeySets(flow, { rawUrls, returnedFindings, prepared, existingSources, targetFields, context }) {
  const existing = existingKeySet(existingSources);
  const preparedDrafts = uniqueDrafts(prepared);
  const keySets = {
    raw: uniqueDrafts(rawUrls).map(draftIdentityKey).filter(Boolean),
    returned: uniqueDrafts(returnedFindings).map(draftIdentityKey).filter(Boolean),
    prepared: [],
    newUnique: [],
    fieldRelevant: [],
    subjectValid: [],
    coverageEligible: [],
    coverageEligibleByField: Object.fromEntries(
      unique(targetFields).map((f) => [f, []])
    ),
  };
  for (const source of preparedDrafts) {
    const key = draftIdentityKey(source);
    if (!key) continue;
    keySets.prepared.push(key);
    if (!existing.has(key)) keySets.newUnique.push(key);
    const classified = classifyDraftEvidence(source, { targetFields, context });
    if (classified.fieldRelevant) keySets.fieldRelevant.push(key);
    if (classified.subjectValid) keySets.subjectValid.push(key);
    if (classified.coverageEligible) keySets.coverageEligible.push(key);
    for (const row of classified.fieldRows || []) {
      if (!row.coverageEligible) continue;
      if (!keySets.coverageEligibleByField[row.field]) {
        keySets.coverageEligibleByField[row.field] = [];
      }
      keySets.coverageEligibleByField[row.field].push(key);
    }
  }
  flow.keySets = keySets;
  return flow;
}

export function summarizeSourceFlow(flows = []) {
  const list = (flows || []).map((f) => f?.sourceFlow || f).filter(Boolean);
  const raw = list.reduce((n, f) => n + (Number(f.rawUrlCount) || 0), 0);
  const returned = list.reduce(
    (n, f) => n + (Number(f.returnedFindingCount ?? f.mergedCount) || 0),
    0
  );
  const fieldRelevant = list.reduce(
    (n, f) => n + (Number(f.fieldRelevantCount) || 0),
    0
  );
  const subjectValid = list.reduce(
    (n, f) => n + (Number(f.subjectValidCount) || 0),
    0
  );
  const coverageEligible = list.reduce(
    (n, f) => n + (Number(f.coverageEligibleCount) || 0),
    0
  );
  const subjectRejected = subjectRejectedCount(fieldRelevant, subjectValid);
  return {
    rawToReturnedRate: flowRatio(returned, raw),
    returnedToFieldRelevantRate: flowRatio(fieldRelevant, returned),
    fieldRelevantToSubjectValidRate: flowRatio(subjectValid, fieldRelevant),
    subjectValidToCoverageEligibleRate: flowRatio(coverageEligible, subjectValid),
    fieldRelevantCount: fieldRelevant,
    subjectValidCount: subjectValid,
    coverageEligibleCount: coverageEligible,
    coverageContributingCount: coverageEligible,
    subjectRejectedCount: subjectRejected,
    adaptiveJobSubjectRejectedCount: subjectRejected,
    qualityStrongCount: list.reduce(
      (n, f) => n + (Number(f.qualityStrongCount) || 0),
      0
    ),
    qualityUsableCount: list.reduce(
      (n, f) => n + (Number(f.qualityUsableCount) || 0),
      0
    ),
    qualityWeakCount: list.reduce(
      (n, f) => n + (Number(f.qualityWeakCount) || 0),
      0
    ),
    qualityIneligibleCount: list.reduce(
      (n, f) => n + (Number(f.qualityIneligibleCount) || 0),
      0
    ),
    cappedFieldRelevantCount: list.reduce(
      (n, f) => n + (Number(f.cappedFieldRelevantCount) || 0),
      0
    ),
    wrongSubjectRejectedCount: subjectRejected,
    lowCoverageQualityCount: list.reduce(
      (n, f) => n + (Number(f.dropReasons?.lowCoverageQuality) || 0),
      0
    ),
  };
}

export function formatSourceFlowLog(id, flow = {}) {
  const d = flow.dropReasons || {};
  const pad = (label, n) => `${label.padEnd(22)}${n ?? 0}`;
  return [
    id || "job",
    pad("raw URLs:", flow.rawUrlCount),
    pad("model findings:", flow.modelFindingCount),
    pad("merged before cap:", flow.mergedBeforeCapCount),
    pad("returned:", flow.returnedFindingCount ?? flow.mergedCount),
    pad("prepared:", flow.preparedCount),
    pad("new unique:", flow.newUniqueCount),
    "",
    pad("field relevant:", flow.fieldRelevantCount),
    pad("subject valid:", flow.subjectValidCount),
    pad("quality strong:", flow.qualityStrongCount),
    pad("quality usable:", flow.qualityUsableCount),
    pad("quality ineligible:", flow.qualityIneligibleCount),
    pad("coverage eligible:", flow.coverageEligibleCount),
    "",
    "drops:",
    pad("focus rejected:", d.focusRejected),
    pad("capped:", d.cappedBeforePrepare),
    pad("relevant but capped:", flow.cappedFieldRelevantCount),
    pad("wrong subject:", d.wrongSubject),
    pad("low quality:", d.lowCoverageQuality),
  ].join("\n");
}

export function publicSourceFlow(flow) {
  if (!flow) return emptySourceFlow();
  const { sourceDetails: _details, ...rest } = flow;
  return rest;
}

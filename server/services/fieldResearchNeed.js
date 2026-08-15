/**
 * C.3 field research-need classification + source-mix retrieval preference.
 *
 * Diagnostic + planner input. Does not change coverage scores, stopQuality,
 * evidence relevance patterns, or search budgets.
 *
 * Query hints / mode instructions are retrieval *preferences* sent to
 * OpenAI web_search. They are not controlled site: filters. The current
 * integration uses `{ type: "web_search" }` with no domain filter.
 */

import { fieldQualityClass } from "./evidenceQuality.js";
import { classifySourceRole } from "./evidenceRelevance.js";
import { NEED_TYPES, RETRIEVAL_MODES } from "./retrievalModes.js";

export { NEED_TYPES, RETRIEVAL_MODES };

const ESCALATION_GAP_REASONS = new Set([
  "meaningful_source_conflict",
  "score_missing",
  "insufficient",
]);

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

export function countSourceRoleMix(sources = []) {
  const mix = {
    readerExperienceCount: 0,
    studyGuideCount: 0,
    encyclopediaCount: 0,
    blogCount: 0,
    forumCount: 0,
    goodreadsCount: 0,
    professionalCount: 0,
    otherCount: 0,
  };
  for (const source of sources || []) {
    const role = classifySourceRole(source);
    if (role === "reader_experience") mix.readerExperienceCount += 1;
    else if (role === "study_guide") mix.studyGuideCount += 1;
    else if (role === "encyclopedia") mix.encyclopediaCount += 1;
    const type = String(source?.type || "").toLowerCase();
    if (type === "blog") mix.blogCount += 1;
    else if (type === "forum") mix.forumCount += 1;
    else if (type === "goodreads") mix.goodreadsCount += 1;
    else if (type === "professional") mix.professionalCount += 1;
    else mix.otherCount += 1;
  }
  return mix;
}

export function preferredRolesForMode(mode) {
  if (mode === RETRIEVAL_MODES.READER_DIRECT) return ["reader_experience"];
  if (mode === RETRIEVAL_MODES.SCENE_DIRECT) {
    return ["reader_experience"];
  }
  if (mode === RETRIEVAL_MODES.DIVERSITY) {
    return ["reader_experience", "professional"];
  }
  return [];
}

export function defaultModeForFieldClass(fieldClass, needType) {
  if (fieldClass === "narrative" || fieldClass === "content_descriptor") {
    return RETRIEVAL_MODES.GENERAL;
  }
  if (fieldClass === "reader_experience") return RETRIEVAL_MODES.READER_DIRECT;
  if (needType === NEED_TYPES.SUPPORTING_SATURATED) {
    return RETRIEVAL_MODES.READER_DIRECT;
  }
  if (fieldClass === "behavior" && needType === NEED_TYPES.NEEDS_DIRECT) {
    return RETRIEVAL_MODES.SCENE_DIRECT;
  }
  if (
    fieldClass === "behavior" ||
    fieldClass === "relationship" ||
    fieldClass === "fmc_development" ||
    fieldClass === "character_development"
  ) {
    if (needType === NEED_TYPES.NO_EVIDENCE) {
      return fieldClass === "behavior"
        ? RETRIEVAL_MODES.SCENE_DIRECT
        : RETRIEVAL_MODES.READER_DIRECT;
    }
    return RETRIEVAL_MODES.READER_DIRECT;
  }
  return RETRIEVAL_MODES.GENERAL;
}

function roleDominated(mix = {}) {
  const counted =
    (mix.readerExperienceCount || 0) +
    (mix.studyGuideCount || 0) +
    (mix.encyclopediaCount || 0) +
    (mix.blogCount || 0) +
    (mix.forumCount || 0) +
    (mix.goodreadsCount || 0) +
    (mix.professionalCount || 0) +
    (mix.otherCount || 0);
  if (counted < 2) return false;
  const studyLike = (mix.studyGuideCount || 0) + (mix.encyclopediaCount || 0);
  return studyLike / counted >= 0.67;
}

function missingPreferredRoles(mix = {}) {
  const out = [];
  if (!(mix.readerExperienceCount > 0)) out.push("reader_experience");
  if (!(mix.professionalCount > 0) && !(mix.blogCount > 0)) out.push("professional");
  return out.length ? out : ["reader_experience"];
}

/**
 * Deterministic research-need from a C.2.1 field snapshot.
 * Reuses existing snapshot fields. No new coverage rules.
 */
export function classifyFieldResearchNeed(snapshot = {}) {
  const field = snapshot.field || null;
  const fieldClass = fieldQualityClass(field);
  const direct = Number(snapshot.directEvidenceCount) || 0;
  const supporting = Number(snapshot.supportingEvidenceCount) || 0;
  const stop = Boolean(snapshot.stopQualitySatisfied);
  const needsStrongDirect = Boolean(snapshot.needsStrongDirect);
  const saturated = Boolean(snapshot.supportingSaturated);
  const mix = snapshot.sourceRoleMix || {};
  const readerCount = Number(mix.readerExperienceCount) || 0;
  const uniqueDomains = Number(
    snapshot.uniqueDomains ?? snapshot.independentDomains
  ) || 0;
  const gapReasons = snapshot.gapReasons || snapshot.reasons || [];
  const conflict = gapReasons.includes("meaningful_source_conflict");
  const readerDeficit =
    fieldClass === "reader_experience" && readerCount === 0;

  const base = {
    field,
    fieldClass,
    readerDeficit,
    reasons: [],
    preferredSourceRoles: [],
    preferredRetrievalMode: RETRIEVAL_MODES.GENERAL,
  };

  if (stop && !needsStrongDirect && !conflict) {
    return {
      ...base,
      needType: NEED_TYPES.RESOLVED,
      reasons: ["stop_quality_satisfied"],
    };
  }

  if (readerDeficit && !stop) {
    return {
      ...base,
      needType: NEED_TYPES.NEEDS_READER_EVIDENCE,
      reasons: ["reader_source_deficit"],
      preferredSourceRoles: ["reader_experience"],
      preferredRetrievalMode: RETRIEVAL_MODES.READER_DIRECT,
    };
  }

  if (direct === 0 && supporting === 0) {
    const mode = defaultModeForFieldClass(fieldClass, NEED_TYPES.NO_EVIDENCE);
    return {
      ...base,
      needType: NEED_TYPES.NO_EVIDENCE,
      reasons: ["no_field_evidence"],
      preferredSourceRoles: preferredRolesForMode(mode),
      preferredRetrievalMode: mode,
    };
  }

  if (saturated && (needsStrongDirect || (!stop && direct === 0))) {
    const mode = defaultModeForFieldClass(
      fieldClass,
      NEED_TYPES.SUPPORTING_SATURATED
    );
    return {
      ...base,
      needType: NEED_TYPES.SUPPORTING_SATURATED,
      reasons: unique(["supporting_saturated", needsStrongDirect ? "needs_strong_direct" : null]),
      preferredSourceRoles: preferredRolesForMode(mode),
      preferredRetrievalMode: mode,
    };
  }

  if (needsStrongDirect || (supporting > 0 && !stop && direct === 0)) {
    const mode = defaultModeForFieldClass(fieldClass, NEED_TYPES.NEEDS_DIRECT);
    return {
      ...base,
      needType: NEED_TYPES.NEEDS_DIRECT,
      reasons: ["needs_strong_direct"],
      preferredSourceRoles: preferredRolesForMode(mode),
      preferredRetrievalMode: mode,
    };
  }

  if (
    (uniqueDomains <= 1 && direct + supporting >= 2) ||
    roleDominated(mix)
  ) {
    return {
      ...base,
      needType: NEED_TYPES.NEEDS_DIVERSITY,
      reasons: ["low_source_diversity"],
      preferredSourceRoles: missingPreferredRoles(mix),
      preferredRetrievalMode: RETRIEVAL_MODES.DIVERSITY,
    };
  }

  if (conflict) {
    return {
      ...base,
      needType: NEED_TYPES.NEEDS_DIVERSITY,
      reasons: ["meaningful_source_conflict"],
      preferredSourceRoles: ["reader_experience"],
      preferredRetrievalMode: RETRIEVAL_MODES.DIVERSITY,
    };
  }

  return {
    ...base,
    needType: stop ? NEED_TYPES.RESOLVED : NEED_TYPES.NEEDS_DIRECT,
    reasons: stop ? ["stop_quality_satisfied"] : ["unresolved_quality"],
    preferredRetrievalMode: stop
      ? RETRIEVAL_MODES.GENERAL
      : defaultModeForFieldClass(fieldClass, NEED_TYPES.NEEDS_DIRECT),
    preferredSourceRoles: stop
      ? []
      : preferredRolesForMode(
          defaultModeForFieldClass(fieldClass, NEED_TYPES.NEEDS_DIRECT)
        ),
  };
}

export function fieldStillNeedsFollowUp(gap, snapshot) {
  const need = classifyFieldResearchNeed(snapshot || { field: gap?.field });
  if (need.needType === NEED_TYPES.RESOLVED) {
    return (gap?.reasons || []).some((r) => ESCALATION_GAP_REASONS.has(r));
  }
  return true;
}

export function selectGroupRetrievalMode(needs = []) {
  const list = needs || [];
  if (list.some((n) => n.needType === NEED_TYPES.SUPPORTING_SATURATED)) {
    return RETRIEVAL_MODES.READER_DIRECT;
  }
  if (list.some((n) => n.needType === NEED_TYPES.NEEDS_READER_EVIDENCE)) {
    return RETRIEVAL_MODES.READER_DIRECT;
  }
  const directNeeds = list.filter((n) => n.needType === NEED_TYPES.NEEDS_DIRECT);
  if (directNeeds.length) {
    if (directNeeds.some((n) => n.fieldClass === "behavior")) {
      return RETRIEVAL_MODES.SCENE_DIRECT;
    }
    return RETRIEVAL_MODES.READER_DIRECT;
  }
  if (list.some((n) => n.needType === NEED_TYPES.NEEDS_DIVERSITY)) {
    return RETRIEVAL_MODES.DIVERSITY;
  }
  const empty = list.find((n) => n.needType === NEED_TYPES.NO_EVIDENCE);
  if (empty) return empty.preferredRetrievalMode || RETRIEVAL_MODES.GENERAL;
  return RETRIEVAL_MODES.GENERAL;
}

/**
 * Instruction text only. Does not claim we search a site directly.
 */
export function retrievalModeInstruction(mode) {
  if (mode === RETRIEVAL_MODES.READER_DIRECT) {
    return `Retrieval instruction prioritizes reader/forum/review sources: Reddit-style discussion, Goodreads reviews, independent review blogs, and first-person reader interpretation of concrete scenes. Generic character encyclopedias and study-guide summaries are weaker for this need and should not be the primary target.`;
  }
  if (mode === RETRIEVAL_MODES.SCENE_DIRECT) {
    return `Retrieval instruction prioritizes concrete scene and action descriptions: what happens when the heroine is endangered, hurt, or threatened; chapter/scene discussion; reviews that recount a specific reaction or consequence. Trope labels alone are not enough.`;
  }
  if (mode === RETRIEVAL_MODES.DIVERSITY) {
    return `Retrieval instruction prioritizes source roles not already well represented. Prefer independent reviews or reader discussions rather than repeating the same encyclopedia or study-guide type.`;
  }
  return "";
}

export function classifySourceMixOutcome({
  retrievalStatus = null,
  preparedCount = 0,
  newStrongDirectCount = 0,
  newUsableSupportingCount = 0,
  readerEvidenceRecovered = false,
  fieldRelevantCount = 0,
  wrongSubjectCount = 0,
} = {}) {
  if (
    retrievalStatus === "retrieval_zero" ||
    (Number(preparedCount) || 0) === 0
  ) {
    return "zero_retrieval";
  }
  if ((Number(newStrongDirectCount) || 0) > 0) return "strong_direct_recovered";
  if (readerEvidenceRecovered) return "reader_source_recovered";
  if ((Number(newUsableSupportingCount) || 0) > 0) return "supporting_only";
  if (
    (Number(wrongSubjectCount) || 0) > 0 &&
    (Number(fieldRelevantCount) || 0) > 0 &&
    Number(wrongSubjectCount) >= Number(fieldRelevantCount)
  ) {
    return "wrong_subject_only";
  }
  return "irrelevant";
}

function mergeRoleMixes(mixes = []) {
  const out = countSourceRoleMix([]);
  for (const mix of mixes) {
    if (!mix) continue;
    for (const key of Object.keys(out)) {
      out[key] += Number(mix[key]) || 0;
    }
  }
  return out;
}

export function enrichJobsWithSourceMixOutcomes(roundRecord, { research } = {}) {
  const jobs = roundRecord?.jobs || [];
  const before = roundRecord?.fieldSnapshotsBefore || [];
  const after = roundRecord?.fieldSnapshotsAfter || [];
  let newStrongDirectCount = 0;
  let newUsableSupportingCount = 0;
  const beforeByField = Object.fromEntries(before.map((s) => [s.field, s]));
  for (const snap of after) {
    const prev = beforeByField[snap.field] || {};
    newStrongDirectCount += Math.max(
      0,
      (snap.directEvidenceCount || 0) - (prev.directEvidenceCount || 0)
    );
    newUsableSupportingCount += Math.max(
      0,
      (snap.supportingEvidenceCount || 0) - (prev.supportingEvidenceCount || 0)
    );
  }
  const readerBefore = before.reduce(
    (n, s) => n + (Number(s.sourceRoleMix?.readerExperienceCount) || 0),
    0
  );
  const readerAfter = after.reduce(
    (n, s) => n + (Number(s.sourceRoleMix?.readerExperienceCount) || 0),
    0
  );
  const readerEvidenceRecovered = readerAfter > readerBefore;
  const strongDirectRecovered = newStrongDirectCount > 0;
  const actuallyCountedRoleMix = mergeRoleMixes(after.map((s) => s.sourceRoleMix));

  const sources = research?.sources || [];
  const idToKey = new Map(
    sources.map((s) => [s.id, s.url || s.id])
  );
  const keysOf = (ids = []) =>
    new Set((ids || []).map((id) => idToKey.get(id) || id));

  const afterDirectKeys = new Set();
  const beforeDirectKeys = new Set();
  for (const snap of after) {
    for (const id of snap.directEvidenceSourceIds || []) {
      afterDirectKeys.add(idToKey.get(id) || id);
    }
  }
  for (const snap of before) {
    for (const id of snap.directEvidenceSourceIds || []) {
      beforeDirectKeys.add(idToKey.get(id) || id);
    }
  }

  for (const job of jobs) {
    const eligible = job.sourceFlow?.keySets?.coverageEligible || [];
    const jobNewDirect = eligible.filter(
      (key) => afterDirectKeys.has(key) && !beforeDirectKeys.has(key)
    ).length;
    const flow = job.sourceFlow || {};
    job.actuallyCountedRoleMix = actuallyCountedRoleMix;
    job.newStrongDirectCount = jobNewDirect;
    job.newUsableSupportingCount = newUsableSupportingCount;
    job.strongDirectRecovered = jobNewDirect > 0 || (jobs.length === 1 && strongDirectRecovered);
    job.readerEvidenceRecovered = readerEvidenceRecovered;
    job.sourceMixOutcome = classifySourceMixOutcome({
      retrievalStatus: job.retrievalStatus,
      preparedCount: job.preparedCount ?? job.sourceCount,
      newStrongDirectCount: job.newStrongDirectCount,
      newUsableSupportingCount: job.newUsableSupportingCount,
      readerEvidenceRecovered,
      fieldRelevantCount: flow.fieldRelevantCount,
      wrongSubjectCount: flow.dropReasons?.wrongSubject,
    });
  }

  roundRecord.sourceMixSummary = {
    newStrongDirectCount,
    newUsableSupportingCount,
    strongDirectRecovered,
    readerEvidenceRecovered,
    actuallyCountedRoleMix,
  };
  return roundRecord;
}

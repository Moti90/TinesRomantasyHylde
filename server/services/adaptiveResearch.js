/**
 * Adaptive research intelligence (Bid 1).
 *
 * Pure analysis of existing research + assessments.
 * Does not call OpenAI, websearch, pipeline, or Postgres.
 *
 * Future claim engines can replace assessments as long as they expose
 * the generic claim shape used here (score, confidence, basis, evidence IDs).
 */

import {
  SUBJECTIVE_KEYS,
  getTineFieldWeight,
  isCriticalTineField,
} from "./decisionScores.js";
import {
  FIELD_TO_BATCH,
  FIELD_PHENOMENON_PATTERNS,
  findPhenomenonSourceIds,
} from "./evidenceMapping.js";
import {
  classifySourceRole,
  criticalFieldStopQualitySatisfied,
  evaluateSourceForField,
  isFieldSpecificEvidence,
  isReaderExperienceSource,
  isStudyGuideUrl,
} from "./evidenceRelevance.js";
import { evaluateEvidenceQualityForField } from "./evidenceQuality.js";
import {
  ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE,
  ADAPTIVE_FIELD_MIN_COVERAGE,
  ADAPTIVE_MAX_JOBS_PER_ROUND,
  ADAPTIVE_TARGET_COVERAGE,
  ADAPTIVE_VERSION,
  isAdaptiveDebugEnabled,
} from "./versions.js";
import {
  canonicalizeUrl,
  classifySourceType,
  inferSeriesRomanticLeads,
  normalizeStructuredPairing,
  sourceDedupeKey,
} from "./webResearch.js";
import {
  characterNameMentionedInText,
  namesReferToSamePerson,
  subjectIdentityFrom,
} from "./sourceSubject.js";
import {
  buildRetrievalApproaches,
  flattenRetrievalApproaches,
} from "./searchRetrieval.js";
import {
  classifyFieldResearchNeed,
  fieldStillNeedsFollowUp,
  retrievalModeInstruction,
  selectGroupRetrievalMode,
} from "./fieldResearchNeed.js";
import {
  selectRomanceScopeForJob,
  semanticPairingKey,
} from "./seriesRomancePlanning.js";

const MAX_TINE_WEIGHT = 1.4;
const NO_DIRECT_EVIDENCE_CAP = 25;
const CONTEXTUAL_ONLY_CAP = 25;
const INSUFFICIENT_CAP = 12;
const AI_INFERENCE_NO_EVIDENCE_CAP = 15;
const SYNOPSIS_NO_EVIDENCE_CAP = 18;

const WEAK_SUBJECTIVE_TYPES = new Set([
  "catalog",
  "publisher",
  "official",
]);
const STRONG_SUBJECTIVE_TYPES = new Set([
  "forum",
  "goodreads",
  "blog",
  "professional",
]);

const NAME_STOPWORDS = new Set([
  "The",
  "A",
  "An",
  "He",
  "She",
  "His",
  "Her",
  "Hero",
  "Heroine",
  "Between",
  "And",
  "With",
  "From",
  "This",
  "That",
  "Book",
  "Series",
]);

/** Human-readable phenomena for follow-up prompts (matching uses FIELD_PHENOMENON_PATTERNS). */
export const FIELD_TARGET_PHENOMENA = {
  "Touch her and die-vibe (0-5)": [
    "touch her and die",
    "goes feral",
    "violent protective reaction",
  ],
  "Bodyguard-vibe (0-5)": [
    "bodyguard / guardian dynamic",
    "keeps her safe",
    "watching over her",
  ],
  "Beskyttende helt(e) (0-5)": [
    "protective behaviour",
    "guardian instinct",
    "keeps her safe",
  ],
  "Rhysand-faktoren": [
    "respects her agency",
    "morally grey but equal partner",
    "supports her power",
  ],
  "Kvindelig udvikling (0-5)": [
    "heroine growth",
    "female character arc",
    "strong heroine development",
  ],
  "Karakterudvikling (0-5)": ["character development", "character arc"],
  "Spice/erotik (0-5)": ["spice level", "open door vs fade to black", "steamy scenes"],
  "Spice/erotik kvalitet (0-5)": [
    "spice quality",
    "well-written intimate scenes",
  ],
  "Romance i fokus (0-100%)": ["romance focus", "romance vs plot balance"],
  "Worldbuilding (0-5)": ["worldbuilding", "magic system", "rich world"],
  "Episk plot (0-5)": ["epic plot", "high stakes", "grand scale"],
  "Politiske intriger (0-5)": ["political intrigue", "court intrigue"],
  "Krig/militær (0-5)": ["war", "military conflict", "battles"],
  "Book hangover (0-5)": ["book hangover", "couldn't put it down"],
  "Hvor hurtigt griber den? (0-100%)": ["pacing", "how quickly it grabs"],
};

export const FOLLOWUP_STRATEGY_GROUPS = [
  {
    strategy: "hero_protective_dynamic",
    batchHint: "helteprofil",
    fields: [
      "Beskyttende helt(e) (0-5)",
      "Bodyguard-vibe (0-5)",
      "Touch her and die-vibe (0-5)",
    ],
  },
  {
    strategy: "hero_respect_agency",
    batchHint: "helteprofil",
    fields: ["Rhysand-faktoren"],
  },
  {
    strategy: "heroine_growth",
    batchHint: "plotkarakter",
    fields: ["Kvindelig udvikling (0-5)", "Karakterudvikling (0-5)"],
  },
  {
    strategy: "romance_spice",
    batchHint: "romanceprofil",
    fields: [
      "Spice/erotik (0-5)",
      "Spice/erotik kvalitet (0-5)",
      "Romance i fokus (0-100%)",
    ],
  },
  {
    strategy: "plot_worldbuilding",
    batchHint: "plotkarakter",
    fields: [
      "Worldbuilding (0-5)",
      "Episk plot (0-5)",
      "Politiske intriger (0-5)",
      "Krig/militær (0-5)",
    ],
  },
  {
    strategy: "reader_emotional_response",
    batchHint: "helhed",
    fields: ["Book hangover (0-5)", "Hvor hurtigt griber den? (0-100%)"],
  },
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function roundScore(n) {
  return Math.round(clamp(n, 0, 100));
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/**
 * Generic claim/assessment view. Bid 2+ can swap in a real claim engine
 * without changing coverage/planner signatures.
 */
export function asClaim(field, assessment) {
  const a = assessment || {};
  return {
    field,
    score: a.score ?? null,
    confidence: a.confidence || "low",
    basis: a.basis || (a.score == null ? "insufficient" : "ai_inference"),
    evidenceSourceIds: Array.isArray(a.evidenceSourceIds)
      ? unique(a.evidenceSourceIds)
      : [],
    conflictingSourceIds: Array.isArray(a.conflictingSourceIds)
      ? unique(a.conflictingSourceIds)
      : [],
    sourceCount: Number(a.sourceCount) || 0,
    sourceBatch: a.sourceBatch || FIELD_TO_BATCH[field] || null,
    reason: a.reason || "",
  };
}

export function sourceDomain(source) {
  const url = source?.url || "";
  try {
    const host = new URL(canonicalizeUrl(url) || url).hostname.toLowerCase();
    if (host.includes("reddit.com")) return "reddit.com";
    if (host.includes("goodreads.com")) return "goodreads.com";
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Stable source identity for this research object.
 * Does not use array index. Bid 2 can persist identityKey across rounds.
 */
export function sourceIdentityKey(source) {
  if (!source) return "";
  const fallback = source.id ? `id:${source.id}` : "";
  return sourceDedupeKey(source.url, fallback);
}

export function resolveSourceIdentity(source) {
  return {
    sourceId: source?.id || null,
    identityKey: sourceIdentityKey(source),
    canonicalUrl: canonicalizeUrl(source?.url) || "",
    domain: sourceDomain(source),
    type:
      source?.type ||
      classifySourceType(source?.url, source?.title, source?.type),
  };
}

function normalizeNearDupeText(source) {
  return `${source?.title || ""} ${source?.summary || ""}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNearDuplicateSource(a, b) {
  const ta = normalizeNearDupeText(a);
  const tb = normalizeNearDupeText(b);
  if (!ta || !tb || ta.length < 48 || tb.length < 48) return false;
  return ta === tb;
}

export function nextSourceNumber(existingSources) {
  let max = 0;
  for (const s of existingSources || []) {
    const m = String(s?.id || "").match(/^source-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function summaryQuality(source) {
  const summary = String(source?.summary || "").trim();
  if (!summary) return 0;
  if (/^Fundet via /i.test(summary)) return 2;
  return Math.min(80, summary.length);
}

function uniqueStrings(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function knownCharacterNames(existing, incoming) {
  const names = [
    existing?.subjectHints?.mentionedCharacters,
    incoming?.subjectHints?.mentionedCharacters,
  ]
    .flat()
    .filter(Boolean);
  return names;
}

function pickMergedSummary(existing, incoming) {
  const incQ = summaryQuality(incoming);
  const exQ = summaryQuality(existing);
  const names = knownCharacterNames(existing, incoming);
  const incNamed =
    names.some((n) => characterNameMentionedInText(incoming?.summary, n)) ||
    /[A-ZÆØÅ][a-zæøå]{2,}/.test(String(incoming?.summary || ""));
  const exNamed = names.some((n) =>
    characterNameMentionedInText(existing?.summary, n)
  );
  if (exNamed && !characterNameMentionedInText(incoming?.summary, names[0] || "") && incQ <= exQ) {
    return existing.summary;
  }
  if (
    /^Fundet via /i.test(String(existing?.summary || "")) &&
    incQ >= 2 &&
    String(incoming?.summary || "").trim()
  ) {
    return String(incoming.summary);
  }
  if (incNamed && /^the (?:male lead|hero|mmc)\b/i.test(String(existing?.summary || ""))) {
    return String(incoming.summary);
  }
  return incQ > exQ ? String(incoming.summary) : existing.summary;
}

function enrichExistingSource(existing, incoming) {
  const betterSummary = pickMergedSummary(existing, incoming);
  const targetFields = uniqueStrings([
    ...(existing.targetFields || []),
    ...(incoming.targetFields || []),
  ]);
  const adaptiveStrategies = uniqueStrings([
    ...(existing.adaptiveStrategies || []),
    ...(incoming.adaptiveStrategies || []),
    incoming.strategy,
    existing.strategy,
  ]);
  const foundInRounds = uniqueStrings([
    ...(existing.foundInRounds || []),
    ...(incoming.foundInRounds || []),
    incoming.adaptiveRound,
    existing.adaptiveRound,
  ]).map((n) => Number(n) || n);
  const purpose =
    existing.purpose === "identity" || incoming.purpose === "identity"
      ? "identity"
      : existing.purpose || incoming.purpose;

  return {
    ...existing,
    summary: betterSummary,
    title: existing.title || incoming.title,
    type: existing.type || incoming.type,
    batch: existing.batch || incoming.batch,
    purpose,
    targetFields: targetFields.length ? targetFields : existing.targetFields,
    adaptiveStrategies: adaptiveStrategies.length
      ? adaptiveStrategies
      : existing.adaptiveStrategies,
    foundInRounds: foundInRounds.length ? foundInRounds : existing.foundInRounds,
    followUpJobId: existing.followUpJobId || incoming.followUpJobId,
    strategy: existing.strategy || incoming.strategy,
    adaptiveRound: existing.adaptiveRound ?? incoming.adaptiveRound,
    nearDuplicate: Boolean(existing.nearDuplicate || incoming.nearDuplicate),
    subjectHints: incoming.subjectHints || existing.subjectHints,
  };
}

/**
 * Merge follow-up sources into the existing list without renumbering.
 * Duplicate identity (canonical URL / Reddit post / Goodreads show) enriches metadata.
 */
export function mergeAdaptiveSources(existingSources, newSources) {
  const sources = [...(existingSources || [])];
  const byKey = new Map();
  for (const s of sources) {
    const key = sourceIdentityKey(s);
    if (key) byKey.set(key, s);
  }

  const added = [];
  const enriched = [];
  const skippedNearDuplicates = [];
  let nextNum = nextSourceNumber(sources);

  for (const incoming of newSources || []) {
    if (!incoming) continue;
    const key = sourceIdentityKey(incoming);
    const prev = key ? byKey.get(key) : null;
    if (prev) {
      const merged = enrichExistingSource(prev, incoming);
      const idx = sources.findIndex((s) => s.id === prev.id);
      if (idx >= 0) sources[idx] = merged;
      byKey.set(key, merged);
      enriched.push(merged);
      continue;
    }

    const nearOf = sources.find((s) => isNearDuplicateSource(s, incoming));
    const row = {
      ...incoming,
      id: `source-${nextNum}`,
      nearDuplicate: Boolean(nearOf),
    };
    nextNum += 1;
    sources.push(row);
    if (key) byKey.set(key, row);
    if (nearOf) skippedNearDuplicates.push(row);
    else added.push(row);
  }

  return { sources, added, enriched, skippedNearDuplicates };
}

export function findSourceById(research, id) {
  if (!id) return null;
  return (research?.sources || []).find((s) => s?.id === id) || null;
}

function sourceTypeOf(source) {
  return (
    source?.type ||
    classifySourceType(source?.url, source?.title, source?.declaredType || source?.type)
  );
}

/** 0–1 quality for subjective Tine fields. Catalog/publisher copy is near-useless. */
export function subjectiveSourceQuality(source) {
  const type = sourceTypeOf(source);
  const role = classifySourceRole(source);
  if (role === "study_guide" || isStudyGuideUrl(source?.url)) return 0.35;
  if (STRONG_SUBJECTIVE_TYPES.has(type)) return 1;
  if (WEAK_SUBJECTIVE_TYPES.has(type)) return 0.1;
  if (type === "wikipedia") return 0.35;
  if (role === "catalog_social") return 0.45;
  return 0.4;
}

/**
 * Global type-quality floor used by round relevance (`isFollowUpSourceRelevant`)
 * and benchmark heuristics. Coverage no longer uses this as the only gate;
 * see evaluateEvidenceQualityForField (C.1.3).
 */
export const SUBJECTIVE_COVERAGE_QUALITY_MIN = 0.5;

export function isSubjectiveCoverageQuality(source) {
  return subjectiveSourceQuality(source) >= SUBJECTIVE_COVERAGE_QUALITY_MIN;
}

export function calculateEvidenceDiversity(sources) {
  const byKey = new Map();
  for (const s of sources || []) {
    const key = sourceIdentityKey(s);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, s);
  }
  const uniqueSources = [...byKey.values()];
  const urls = new Set();
  const domains = new Map();
  const types = new Set();

  for (const s of uniqueSources) {
    const canon = canonicalizeUrl(s.url) || "";
    if (canon) urls.add(canon);
    const domain = sourceDomain(s);
    if (domain) domains.set(domain, (domains.get(domain) || 0) + 1);
    const type = sourceTypeOf(s);
    if (type) types.add(type);
  }

  const identityCount = uniqueSources.length;
  const maxDomainCount = domains.size ? Math.max(...domains.values()) : 0;

  return {
    uniqueUrls: urls.size,
    uniqueDomains: domains.size,
    sourceTypes: [...types],
    dominantDomainShare: identityCount ? maxDomainCount / identityCount : 0,
    independentIdentities: identityCount,
  };
}

function collectDirectEvidence(field, claim, research, subjectContext = {}) {
  const byKey = new Map();
  const unresolvedIds = [];
  const evalContext = {
    research,
    identity: subjectContext.identity,
    leadCharacters: subjectContext.leadCharacters,
    mmc: subjectContext.mmc,
    fmc: subjectContext.fmc,
    alternatives: subjectContext.alternatives,
  };

  const add = (source, via) => {
    if (!source) return;
    const key = sourceIdentityKey(source);
    if (!key) return;
    const evaluation = evaluateSourceForField({
      source,
      field,
      assessment: claim,
      context: evalContext,
    });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { source, via: [via], evaluation });
      return;
    }
    if (!existing.via.includes(via)) existing.via.push(via);
  };

  for (const id of claim.evidenceSourceIds) {
    const src = findSourceById(research, id);
    if (!src) unresolvedIds.push(id);
    else add(src, "evidence_id");
  }
  for (const id of claim.conflictingSourceIds) {
    const src = findSourceById(research, id);
    if (!src) unresolvedIds.push(id);
    else add(src, "conflict_id");
  }

  const phenomenonIds = findPhenomenonSourceIds(field, research);
  for (const id of phenomenonIds) {
    const src = findSourceById(research, id);
    if (!src || src.purpose === "identity") continue;
    add(src, "phenomenon");
  }

  const items = [...byKey.values()].map((item) => ({
    ...item,
    fieldQuality: evaluateEvidenceQualityForField({
      source: item.source,
      field,
      relevance: item.evaluation?.relevance,
    }),
  }));
  const byLevel = (level) =>
    items.filter((item) => item.evaluation?.relevance === level);

  const direct = items.filter(
    (item) => item.fieldQuality.coverageBucket === "direct"
  );
  const supporting = items.filter(
    (item) => item.fieldQuality.coverageBucket === "supporting"
  );
  const contextual = byLevel("contextual");
  const rejected = items.filter(
    (item) =>
      item.evaluation?.relevance === "none" ||
      (isFieldSpecificEvidence(item.evaluation) && !item.fieldQuality.eligible)
  );
  const fieldSpecific = [...direct, ...supporting];
  const weak = items.filter(
    (item) =>
      isFieldSpecificEvidence(item.evaluation) && !item.fieldQuality.eligible
  );

  return {
    items,
    relevant: fieldSpecific,
    direct,
    supporting,
    contextual,
    rejected,
    weak,
    unresolvedIds: unique(unresolvedIds),
    phenomenonIds: unique(phenomenonIds),
    phenomenonEvidenceCount: fieldSpecific.filter((item) =>
      item.via.includes("phenomenon")
    ).length,
    validatedEvidenceSourceIds: unique(
      fieldSpecific
        .filter((item) => item.via.includes("evidence_id"))
        .map((item) => item.source.id)
        .filter(Boolean)
    ),
  };
}

function fieldEvidencePoints(directCount, supportingCount, weakCount, contextualCount) {
  let pts = 0;
  if (directCount >= 3) pts = 45;
  else if (directCount === 2) pts = 34;
  else if (directCount === 1) pts = 20;
  if (supportingCount > 0) {
    const extra =
      supportingCount === 1 ? 9 : supportingCount === 2 ? 16 : 18;
    if (directCount === 0) pts = extra;
    else pts = Math.min(45, pts + extra);
  }
  if (directCount === 0 && supportingCount === 0) {
    if (weakCount > 0) pts = Math.min(8, 3 + weakCount * 2);
    else if (contextualCount > 0) pts = Math.min(6, contextualCount * 1.5);
  }
  return pts;
}

function confidenceBasisPoints(basis, confidence, hasDirect) {
  if (basis === "insufficient") return 0;
  if (!hasDirect && (basis === "ai_inference" || basis === "synopsis_only")) {
    return 0;
  }
  const confMul =
    confidence === "high" ? 1 : confidence === "medium" ? 0.7 : 0.4;
  if (basis === "source_consensus") return Math.round(20 * confMul);
  if (basis === "mixed_sources") return Math.round(14 * confMul);
  if (basis === "ai_inference") return Math.round(4 * confMul);
  if (basis === "synopsis_only") return Math.round(3 * confMul);
  return 0;
}

function diversityPoints(diversity, relevantCount) {
  if (relevantCount === 0) return 0;
  let domainPts =
    diversity.uniqueDomains >= 3 ? 12 : diversity.uniqueDomains === 2 ? 8 : 3;
  const relevantTypes = (diversity.sourceTypes || []).filter((t) =>
    STRONG_SUBJECTIVE_TYPES.has(t)
  );
  const typePts =
    relevantTypes.length >= 3 ? 6 : relevantTypes.length === 2 ? 4 : 1;
  if (diversity.dominantDomainShare >= 0.8 && diversity.independentIdentities >= 2) {
    domainPts = Math.min(domainPts, 4);
  }
  return domainPts + typePts;
}

function specificityPoints({ relevantCount, linkedRelevant, phenomenonCount, weakOnly }) {
  if (weakOnly || relevantCount === 0) return 0;
  let pts = 0;
  if (linkedRelevant > 0) pts += Math.min(10, 5 + linkedRelevant * 3);
  if (phenomenonCount > 0) pts += Math.min(5, 3 + phenomenonCount);
  if (relevantCount >= 2 && (linkedRelevant > 0 || phenomenonCount > 0)) {
    pts = Math.max(pts, 15);
  } else if (relevantCount >= 1) {
    pts = Math.max(pts, 8);
  }
  return Math.min(15, pts);
}

function conflictLevelOf(supportCount, conflictCount) {
  if (conflictCount <= 0) return "none";
  if (conflictCount >= 2 || conflictCount >= supportCount) return "meaningful";
  if (conflictCount === 1 && supportCount >= 3) return "mild";
  return "meaningful";
}

/** Diagnostic mix of counted (direct+supporting) sources. Does not affect coverage. */
function sourceRoleMixOf(sources = []) {
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

    const type = sourceTypeOf(source);
    if (type === "blog") mix.blogCount += 1;
    else if (type === "forum") mix.forumCount += 1;
    else if (type === "goodreads") mix.goodreadsCount += 1;
    else if (type === "professional") mix.professionalCount += 1;
    else mix.otherCount += 1;
  }
  return mix;
}

function noteCap(capsApplied, name, before, limit) {
  if (before > limit) capsApplied.push(name);
}

export function calculateFieldCoverage({
  field,
  assessment,
  research,
  identity,
  leadCharacters,
} = {}) {
  const claim = asClaim(field, assessment);
  const subjectContext = {
    identity,
    leadCharacters: leadCharacters || research?.seriesIdentity,
    ...subjectIdentityFrom(research, identity, {
      leadCharacters: leadCharacters || research?.seriesIdentity,
    }),
  };
  const evidence = collectDirectEvidence(field, claim, research, subjectContext);
  const directSources = evidence.direct.map((item) => item.source);
  const supportingSources = evidence.supporting.map((item) => item.source);
  const fieldSpecificSources = evidence.relevant.map((item) => item.source);
  const allConsidered = evidence.items.map((item) => item.source);
  const diversity = calculateEvidenceDiversity(fieldSpecificSources);
  const allDiversity = calculateEvidenceDiversity(allConsidered);

  const directCount = evidence.direct.length;
  const supportingCount = evidence.supporting.length;
  const contextualCount = evidence.contextual.length;
  const weakCount = evidence.weak.length;
  const relevantCount = fieldSpecificSources.length;
  const hasFieldEvidence = relevantCount > 0;
  const supportCount = evidence.relevant.filter((item) =>
    item.via.includes("evidence_id")
  ).length;
  const hasIdentity = Boolean(subjectContext.mmc || subjectContext.fmc);
  const conflictCount = evidence.items.filter((item) => {
    if (!item.via.includes("conflict_id")) return false;
    if (!hasIdentity) return true;
    return isFieldSpecificEvidence(item.evaluation);
  }).length;
  const linkedRelevant = evidence.relevant.filter((item) =>
    item.via.includes("evidence_id") || item.via.includes("conflict_id")
  ).length;
  const readerReviewEvidence = fieldSpecificSources.some((s) =>
    isReaderExperienceSource(s)
  );

  const components = {
    directEvidence: fieldEvidencePoints(
      directCount,
      supportingCount,
      weakCount,
      contextualCount
    ),
    confidenceBasis: confidenceBasisPoints(
      claim.basis,
      claim.confidence,
      hasFieldEvidence
    ),
    sourceIndependence: diversityPoints(diversity, relevantCount),
    evidenceSpecificity: specificityPoints({
      relevantCount,
      linkedRelevant,
      phenomenonCount: evidence.phenomenonEvidenceCount,
      weakOnly: relevantCount === 0 && weakCount > 0,
    }),
    readerDiversity: readerReviewEvidence && hasFieldEvidence ? 6 : 0,
  };

  let raw =
    components.directEvidence +
    components.confidenceBasis +
    components.sourceIndependence +
    components.evidenceSpecificity +
    components.readerDiversity;

  if (!hasFieldEvidence && claim.sourceCount > 0) {
    raw += Math.min(4, claim.sourceCount * 0.4);
  }

  const reasons = [];
  if (claim.basis === "insufficient") reasons.push("insufficient");
  if (claim.basis === "ai_inference") reasons.push("ai_inference");
  if (claim.basis === "synopsis_only") reasons.push("synopsis_only");
  if (claim.score == null) reasons.push("score_missing");
  if (!hasFieldEvidence) reasons.push("no_direct_evidence");
  else if (directCount === 0) reasons.push("supporting_only");
  else if (directCount === 1 && supportingCount === 0) {
    reasons.push("low_direct_evidence");
  }
  if (evidence.unresolvedIds.length) reasons.push("unresolved_evidence_ids");
  if (!hasFieldEvidence && claim.sourceCount > 0) {
    reasons.push("batch_count_fallback");
  }
  if (diversity.uniqueDomains <= 1 && relevantCount > 0) {
    reasons.push(relevantCount >= 2 ? "same_domain_stacking" : "single_domain");
  }
  if (diversity.uniqueDomains <= 1 && relevantCount > 0) {
    reasons.push("low_source_diversity");
  }
  const weakTypes = unique(
    evidence.items
      .map((item) => sourceTypeOf(item.source))
      .filter((t) => WEAK_SUBJECTIVE_TYPES.has(t))
  );
  if (weakTypes.length && relevantCount === 0) {
    reasons.push("weak_subjective_source_type");
  }
  if (contextualCount > 0 && !hasFieldEvidence) {
    reasons.push("contextual_only");
  }

  if (evidence.unresolvedIds.length) {
    raw -= 4;
  }

  const conflictLevel = conflictLevelOf(
    Math.max(supportCount, relevantCount - conflictCount),
    conflictCount
  );
  if (conflictLevel === "meaningful") reasons.push("meaningful_source_conflict");
  else if (conflictLevel === "mild") reasons.push("mild_source_conflict");

  const stopQualitySatisfied = criticalFieldStopQualitySatisfied({
    directSources,
    supportingSources,
    score: claim.score,
  });

  const capsApplied = [];
  let coverageScore = raw;
  if (claim.basis === "insufficient") {
    noteCap(capsApplied, "insufficient", coverageScore, INSUFFICIENT_CAP);
    coverageScore = Math.min(coverageScore, INSUFFICIENT_CAP);
  }
  if (!hasFieldEvidence && claim.basis === "ai_inference") {
    noteCap(capsApplied, "ai_inference_no_evidence", coverageScore, AI_INFERENCE_NO_EVIDENCE_CAP);
    coverageScore = Math.min(coverageScore, AI_INFERENCE_NO_EVIDENCE_CAP);
  }
  if (!hasFieldEvidence && claim.basis === "synopsis_only") {
    noteCap(capsApplied, "synopsis_no_evidence", coverageScore, SYNOPSIS_NO_EVIDENCE_CAP);
    coverageScore = Math.min(coverageScore, SYNOPSIS_NO_EVIDENCE_CAP);
  }
  if (!hasFieldEvidence) {
    noteCap(capsApplied, "no_direct_evidence", coverageScore, NO_DIRECT_EVIDENCE_CAP);
    coverageScore = Math.min(coverageScore, NO_DIRECT_EVIDENCE_CAP);
    noteCap(capsApplied, "contextual_only", coverageScore, CONTEXTUAL_ONLY_CAP);
    coverageScore = Math.min(coverageScore, CONTEXTUAL_ONLY_CAP);
  }
  if (isCriticalTineField(field) && coverageScore >= 80 && !hasFieldEvidence) {
    noteCap(capsApplied, "critical_without_field_evidence", coverageScore, CONTEXTUAL_ONLY_CAP);
    coverageScore = Math.min(coverageScore, CONTEXTUAL_ONLY_CAP);
  }
  coverageScore = roundScore(coverageScore);

  const needsResearch =
    coverageScore < ADAPTIVE_FIELD_MIN_COVERAGE ||
    conflictLevel === "meaningful" ||
    claim.score == null ||
    ["insufficient", "ai_inference", "synopsis_only"].includes(claim.basis) ||
    (isCriticalTineField(field) &&
      coverageScore < ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE) ||
    (isCriticalTineField(field) &&
      claim.score != null &&
      !stopQualitySatisfied);

  const idsOf = (items) =>
    unique(items.map((item) => item.source?.id).filter(Boolean));

  const countedSources = [...directSources, ...supportingSources];
  const coverageComponents = {
    directEvidencePoints: components.directEvidence,
    confidenceBasisPoints: components.confidenceBasis,
    sourceIndependencePoints: components.sourceIndependence,
    evidenceSpecificityPoints: components.evidenceSpecificity,
    readerDiversityPoints: components.readerDiversity,
    capsApplied,
    totalCoverage: coverageScore,
  };
  const supportingSaturated = supportingCount >= 3 && directCount === 0;
  const supportingMarginalGainPossible = supportingCount < 3;
  const needsStrongDirect =
    isCriticalTineField(field) &&
    claim.score != null &&
    !stopQualitySatisfied &&
    directCount === 0;

  const result = {
    field,
    coverageScore,
    score: claim.score,
    confidence: claim.confidence,
    basis: claim.basis,
    directEvidenceCount: directCount,
    supportingEvidenceCount: supportingCount,
    contextualEvidenceCount: contextualCount,
    conflictCount,
    uniqueUrls: allDiversity.uniqueUrls || diversity.uniqueUrls,
    independentDomains: diversity.uniqueDomains,
    uniqueDomains: diversity.uniqueDomains,
    sourceTypes: diversity.sourceTypes.length
      ? diversity.sourceTypes
      : allDiversity.sourceTypes,
    phenomenonEvidenceCount: evidence.phenomenonEvidenceCount,
    unresolvedEvidenceIds: evidence.unresolvedIds,
    validatedEvidenceSourceIds: evidence.validatedEvidenceSourceIds,
    directEvidenceSourceIds: idsOf(evidence.direct),
    supportingEvidenceSourceIds: idsOf(evidence.supporting),
    phenomenonMatchedSourceIds: unique(evidence.phenomenonIds),
    assessmentEvidenceSourceIds: unique(claim.evidenceSourceIds),
    conflictLevel,
    needsResearch,
    stopQualitySatisfied,
    readerReviewEvidence,
    reasons: unique(reasons),
    components,
    coverageComponents,
    supportingSaturated,
    supportingMarginalGainPossible,
    needsStrongDirect,
    sourceRoleMix: sourceRoleMixOf(countedSources),
    diversity,
    evidenceDebug: {
      coverage: coverageScore,
      direct: idsOf(evidence.direct),
      supporting: idsOf(evidence.supporting),
      contextual: idsOf(evidence.contextual),
      rejected: idsOf(evidence.rejected),
      domains: diversity.uniqueDomains,
      readerReviewEvidence,
      coverageComponents,
      stopQualitySatisfied,
    },
  };
  result.gapReasons = gapReasonsFor(field, result, claim);
  return result;
}

export function calculateResearchCoverage({
  assessments,
  research,
  identity,
  leadCharacters,
} = {}) {
  const fields = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const field of SUBJECTIVE_KEYS) {
    const coverage = calculateFieldCoverage({
      field,
      assessment: assessments?.[field],
      research,
      identity,
      leadCharacters,
    });
    fields[field] = coverage;
    const w = getTineFieldWeight(field);
    weightedSum += coverage.coverageScore * w;
    weightTotal += w;
  }

  const criticalFieldsBelowMinimum = SUBJECTIVE_KEYS.filter(
    (field) =>
      isCriticalTineField(field) &&
      fields[field].coverageScore < ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE
  );
  const criticalFieldsMissingStopQuality = SUBJECTIVE_KEYS.filter(
    (field) =>
      isCriticalTineField(field) &&
      fields[field].score != null &&
      !fields[field].stopQualitySatisfied
  );

  return {
    weightedCoverage: weightTotal
      ? roundScore(weightedSum / weightTotal)
      : 0,
    fields,
    criticalFieldsBelowMinimum,
    criticalFieldsMissingStopQuality,
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

function gapReasonsFor(field, fieldCoverage, claim) {
  const reasons = [];
  if (claim.score == null) reasons.push("score_missing");
  if (claim.basis === "insufficient") reasons.push("insufficient");
  if (claim.basis === "ai_inference") reasons.push("ai_inference");
  if (claim.basis === "synopsis_only") reasons.push("synopsis_only");
  if (fieldCoverage.directEvidenceCount === 0) reasons.push("no_direct_evidence");
  else if (fieldCoverage.directEvidenceCount === 1) {
    reasons.push("low_direct_evidence");
  }
  if (fieldCoverage.coverageScore < ADAPTIVE_FIELD_MIN_COVERAGE) {
    reasons.push("low_coverage");
  }
  if (claim.confidence === "low") reasons.push("low_confidence");
  if (
    !claim.evidenceSourceIds.length &&
    fieldCoverage.phenomenonEvidenceCount === 0
  ) {
    reasons.push("no_evidence_ids");
  }
  if (fieldCoverage.conflictLevel === "meaningful") {
    reasons.push("meaningful_source_conflict");
  }
  if (
    isCriticalTineField(field) &&
    fieldCoverage.coverageScore < ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE
  ) {
    reasons.push("critical_field");
  }
  if (
    isCriticalTineField(field) &&
    claim.score != null &&
    fieldCoverage.stopQualitySatisfied === false
  ) {
    reasons.push("weak_evidence_quality");
  }
  return unique(reasons);
}

export function calculateGapPriority({ field, coverageScore, claim, conflictLevel }) {
  const tineImportance = clamp(getTineFieldWeight(field) / MAX_TINE_WEIGHT, 0, 1);
  const evidenceDeficit = clamp(1 - (Number(coverageScore) || 0) / 100, 0, 1);
  const weakBasis = ["insufficient", "ai_inference", "synopsis_only"].includes(
    claim?.basis
  );
  const inferenceBoost = weakBasis ? 1.15 : 1;
  const conflictBoost = conflictLevel === "meaningful" ? 1.2 : 1;
  const base = 0.48 * tineImportance + 0.52 * evidenceDeficit;
  const priority = clamp(base * inferenceBoost * conflictBoost, 0, 1);

  return {
    priority: Math.round(priority * 100) / 100,
    priorityFactors: {
      tineImportance: Math.round(tineImportance * 100) / 100,
      evidenceDeficit: Math.round(evidenceDeficit * 100) / 100,
      inferenceBoost,
      conflictBoost,
    },
  };
}

export function detectResearchGaps({ coverage, assessments, research }) {
  const gaps = [];
  const fieldCoverages = coverage?.fields || {};

  for (const field of SUBJECTIVE_KEYS) {
    const fieldCoverage =
      fieldCoverages[field] ||
      calculateFieldCoverage({
        field,
        assessment: assessments?.[field],
        research,
      });
    const claim = asClaim(field, assessments?.[field]);
    const reasons = gapReasonsFor(field, fieldCoverage, claim);

    const isGap =
      reasons.includes("score_missing") ||
      reasons.includes("insufficient") ||
      reasons.includes("ai_inference") ||
      reasons.includes("synopsis_only") ||
      reasons.includes("no_direct_evidence") ||
      reasons.includes("low_coverage") ||
      reasons.includes("meaningful_source_conflict") ||
      reasons.includes("critical_field") ||
      reasons.includes("weak_evidence_quality");

    if (!isGap) continue;

    const { priority, priorityFactors } = calculateGapPriority({
      field,
      coverageScore: fieldCoverage.coverageScore,
      claim,
      conflictLevel: fieldCoverage.conflictLevel,
    });

    gaps.push({
      field,
      coverageScore: fieldCoverage.coverageScore,
      tineWeight: getTineFieldWeight(field),
      reasons,
      targetPhenomena:
        FIELD_TARGET_PHENOMENA[field] ||
        (FIELD_PHENOMENON_PATTERNS[field] || []).map((re) =>
          String(re).replace(/^\/|\/[a-z]*$/g, "")
        ),
      batchHint: FIELD_TO_BATCH[field] || claim.sourceBatch,
      conflictLevel: fieldCoverage.conflictLevel,
      priority,
      priorityFactors,
    });
  }

  gaps.sort((a, b) => b.priority - a.priority || b.tineWeight - a.tineWeight);
  return gaps;
}

function sanitizeCharacterName(name) {
  const n = String(name || "").trim();
  if (n.length < 2 || n.length > 40) return "";
  if (NAME_STOPWORDS.has(n)) return "";
  if (!/^[A-ZÆØÅ][\w'’.-]*(?:[ -][A-ZÆØÅ][\w'’.-]*)?$/.test(n)) return "";
  return n;
}

export function softLeadCharacters(research, identity) {
  const inferred = inferSeriesRomanticLeads(research) || {};
  const fromIdentity = {
    mmc: identity?.mmc || identity?.maleLead || "",
    fmc: identity?.fmc || identity?.femaleLead || "",
  };
  const mmc =
    sanitizeCharacterName(fromIdentity.mmc) ||
    sanitizeCharacterName(inferred.mmc) ||
    "";
  const fmc =
    sanitizeCharacterName(fromIdentity.fmc) ||
    sanitizeCharacterName(inferred.fmc) ||
    "";
  const confidence =
    inferred.confidence || (mmc || fmc ? "medium" : "low");
  const merged = {
    ...inferred,
    mmc,
    fmc,
    confidence,
    basis: inferred.basis || [],
    alternatives: (inferred.alternatives || []).map((alt) => ({
      ...alt,
      name: sanitizeCharacterName(alt.name) || alt.name,
    })),
  };
  return assessSeriesIdentityResolution(merged, { identity, research });
}

export function isSeriesAnalysis(identity) {
  if (identity?.isSeries === true) return true;
  const series = String(identity?.series || "").trim();
  const title = String(identity?.title || "").trim();
  if (series && title && series.toLowerCase() !== title.toLowerCase()) return true;
  if (series && identity?.firstBook) return true;
  return Boolean(series);
}

const SERIES_LEVEL_BASIS = new Set([
  "endgame_partner",
  "central_pairing",
  "named_mmc_endgame",
  "love_interest_endgame",
  "becomes_endgame",
]);

const GENERIC_RELATIONAL_BASIS = new Set([
  "between",
  "mellem",
  "named_mmc",
  "love_interest",
  "early_dates",
]);

export function identitySnapshot(leads = {}) {
  const resolution = leads.resolution || {};
  return {
    mmc: leads.mmc || "",
    fmc: leads.fmc || "",
    confidence: leads.confidence || "low",
    scope: leads.scope || null,
    basis: [...(leads.basis || [])],
    alternatives: (leads.alternatives || []).map((a) => ({
      name: a.name,
      role: a.role,
    })),
    resolved: resolution.resolved === true,
    reason: resolution.reason || null,
    identityHintUsed: resolution.identityHintUsed === true,
    identityHintConfirmed: resolution.identityHintConfirmed === true,
  };
}

function nameMentioned(text, name) {
  return characterNameMentionedInText(text, name);
}

function namesAgree(a, b) {
  if (!a || !b) return true;
  return namesReferToSamePerson(a, b) || nameMentioned(a, b) || nameMentioned(b, a);
}

const SERIES_PAIRING_TEXT =
  /\b(endgame|eventual (?:partner|husband|mate)|central (?:romantic )?(?:pairing|couple|partner)|becomes.{0,40}(?:endgame|partner)|later books?|series[- ]level)\b/i;

function sourcePairingBlob(source) {
  const title = String(source?.title || "").trim();
  const summary = String(source?.summary || "").trim();
  const snippet = String(source?.snippet || "").trim();
  const generic = /^Fundet via /i.test(summary);
  if (generic) return `${title} ${snippet}`.trim();
  return `${title} ${summary} ${snippet}`.trim();
}

function sourcePairingSupport(research, mmc, fmc, { hint = null } = {}) {
  const mmcNames = [mmc, hint?.mmc].filter(Boolean);
  const fmcNames = [fmc, hint?.fmc].filter(Boolean);
  const sources = research?.sources || [];
  const matching = [];
  const seriesLevel = [];
  for (const s of sources) {
    const blob = sourcePairingBlob(s);
    if (!blob) continue;
    const hasMmc = mmcNames.some((n) => nameMentioned(blob, n));
    const hasFmc = fmcNames.some((n) => nameMentioned(blob, n));
    if (!hasMmc && !hasFmc) continue;
    if (hasMmc && (hasFmc || SERIES_PAIRING_TEXT.test(blob))) {
      matching.push(s);
      if (SERIES_PAIRING_TEXT.test(blob) && hasMmc) seriesLevel.push(s);
    }
  }
  const identitySources = matching.filter((s) => s.purpose === "identity");
  return {
    matchingCount: matching.length,
    seriesLevelCount: seriesLevel.length,
    identitySourceCount: identitySources.length,
    evidenceSources: matching.slice(0, 8).map((s) => s.url || s.id || s.title),
    confirmed:
      (matching.length >= 1 && seriesLevel.length >= 1) ||
      matching.length >= 2 ||
      (matching.length >= 1 && identitySources.length >= 1 && seriesLevel.length >= 1) ||
      (matching.length >= 1 &&
        identitySources.length >= 1 &&
        hasMmcAndFmcPair(matching, mmcNames, fmcNames)),
  };
}

function hasMmcAndFmcPair(sources, mmcNames, fmcNames) {
  return sources.some((s) => {
    const blob = sourcePairingBlob(s);
    return (
      mmcNames.some((n) => nameMentioned(blob, n)) &&
      fmcNames.some((n) => nameMentioned(blob, n))
    );
  });
}

export function confirmIdentityHint(leads, { research } = {}) {
  const hint = normalizeStructuredPairing(
    research?.identityHint || research?.structuredPairing
  );
  const hintUsed = Boolean(hint?.mmc || hint?.fmc);
  const mmc = leads?.mmc || "";
  const fmc = leads?.fmc || "";
  const hintAgrees =
    hintUsed &&
    (!hint.mmc || namesAgree(mmc, hint.mmc)) &&
    (!hint.fmc || namesAgree(fmc, hint.fmc));
  const support = sourcePairingSupport(research, mmc, fmc, { hint });
  const hintSeriesBasis = /\b(endgame|central[_ ]pairing|later[- ]series|series[- ]level)\b/i.test(
    `${(hint?.basis || []).join(" ")} ${(leads?.basis || []).join(" ")} ${(leads?.seriesLevelSignals || []).join(" ")}`
  );
  const identityHintConfirmed = Boolean(
    hintAgrees &&
      (support.confirmed ||
        (support.matchingCount >= 1 && hintSeriesBasis) ||
        (support.matchingCount >= 1 &&
          (leads?.seriesLevelSignals || []).length >= 1))
  );
  return {
    identityHintUsed: hintUsed,
    identityHintConfirmed,
    hintAgrees,
    ...support,
  };
}

export function assessSeriesIdentityResolution(leads, { identity, research } = {}) {
  const isSeries = isSeriesAnalysis(identity);
  const base = {
    mmc: leads?.mmc || "",
    fmc: leads?.fmc || "",
    confidence: leads?.confidence || "low",
    basis: [...(leads?.basis || [])],
    alternatives: [...(leads?.alternatives || [])],
    mmcEarly: Boolean(leads?.mmcEarly),
    mmcEndgame: Boolean(leads?.mmcEndgame),
    pairingShiftMentioned: Boolean(leads?.pairingShiftMentioned),
    seriesLevelSignals: [
      ...(leads?.seriesLevelSignals ||
        (leads?.basis || []).filter((b) => SERIES_LEVEL_BASIS.has(b))),
    ],
    scope: isSeries ? "series" : "book",
  };

  const confirmation = confirmIdentityHint(base, { research });
  const seriesSignals = base.seriesLevelSignals;
  const genericSignals = base.basis.filter((b) => GENERIC_RELATIONAL_BASIS.has(b));
  const candidateMmcs = (base.alternatives || []).filter(
    (a) => a.role === "candidate_mmc" && a.name !== base.fmc
  );
  const earlyAlts = (base.alternatives || []).filter(
    (a) => a.role === "early_love_interest"
  );
  const competingCandidates = candidateMmcs.map((a) => a.name);
  const hasMmc = Boolean(base.mmc);
  const hasFmc = Boolean(base.fmc);
  const highConfidence = base.confidence === "high";
  const hasSeriesSignal = seriesSignals.length >= 1;
  const researchPresent = Array.isArray(research?.sources);
  const sourceConfirmed = researchPresent
    ? confirmation.confirmed === true
    : hasSeriesSignal;
  const identityHintConfirmed = confirmation.identityHintConfirmed === true;
  const hasStrongSeriesEvidence =
    identityHintConfirmed ||
    (sourceConfirmed && hasSeriesSignal);
  const competingCandidateBlock =
    candidateMmcs.length >= 1 && !hasStrongSeriesEvidence && !hasSeriesSignal;

  const resolutionChecks = {
    hasMmc,
    hasFmc,
    highConfidence,
    hasSeriesSignal,
    hasStrongSeriesEvidence,
    competingCandidateBlock,
    identityHintUsed: confirmation.identityHintUsed,
    identityHintConfirmed,
  };

  const trace = {
    mmc: base.mmc,
    fmc: base.fmc,
    confidence: base.confidence,
    seriesSignals: [...seriesSignals],
    earlySignals: [
      ...(base.mmcEarly ? ["mmc_early"] : []),
      ...earlyAlts.map((a) => a.name),
    ],
    candidateCount: candidateMmcs.length,
    competingCandidates,
    evidenceSources: confirmation.evidenceSources || [],
    strongSeriesEvidenceCount:
      (confirmation.seriesLevelCount || 0) + (hasSeriesSignal ? seriesSignals.length : 0),
    identityHintUsed: confirmation.identityHintUsed,
    identityHintConfirmed,
    resolutionChecks,
    finalResolved: false,
    finalReason: null,
  };

  const resolve = (resolved, reason) => {
    trace.finalResolved = resolved;
    trace.finalReason = reason;
    if (isAdaptiveDebugEnabled()) {
      console.log("[adaptive:identity]", JSON.stringify(trace, null, 2));
    }
    return {
      ...base,
      resolution: {
        resolved,
        reason,
        identityHintUsed: confirmation.identityHintUsed,
        identityHintConfirmed,
        trace,
      },
    };
  };

  if (!isSeries) {
    return resolve(true, "standalone_book");
  }

  if (!hasMmc || !hasFmc) {
    return resolve(false, "missing_lead");
  }
  if (base.confidence === "low" && !identityHintConfirmed) {
    return resolve(false, "low_confidence");
  }
  if (competingCandidateBlock) {
    return resolve(false, "ambiguous_candidates");
  }
  if (hasStrongSeriesEvidence && !competingCandidateBlock) {
    const reason = identityHintConfirmed
      ? "series_pairing_confirmed"
      : seriesSignals.length >= 2 || highConfidence
        ? "series_endgame_supported"
        : "series_level_pairing_supported";
    return resolve(true, reason);
  }
  if (hasSeriesSignal && candidateMmcs.length === 0 && sourceConfirmed) {
    const reason =
      seriesSignals.length >= 2 || highConfidence
        ? "series_endgame_supported"
        : "series_level_pairing_supported";
    return resolve(true, reason);
  }
  if (genericSignals.length && seriesSignals.length === 0) {
    return resolve(false, "book1_only_evidence");
  }
  if (
    (base.mmcEarly || earlyAlts.length > 0 || base.pairingShiftMentioned) &&
    seriesSignals.length === 0
  ) {
    return resolve(false, "pairing_shift_unresolved");
  }
  if (base.confidence === "medium" && seriesSignals.length === 0) {
    return resolve(false, "book1_only_evidence");
  }
  return resolve(false, "insufficient_series_evidence");
}

export function shouldTriggerIdentitySearch(leads, identity) {
  if (!isSeriesAnalysis(identity)) return false;
  return leads?.resolution?.resolved !== true;
}

export function needsLegacyIdentityResolution(leads, identity) {
  return shouldTriggerIdentitySearch(leads, identity);
}

function leadsUnresolved(leadCharacters) {
  return leadCharacters?.resolution?.resolved !== true;
}

export function buildIdentityResolutionJob({ identity, leadCharacters } = {}) {
  const series = seriesContext(identity);
  const seriesTitle = series.title || identity?.series || identity?.title || "series";
  const firstBook = series.firstBook || series.workTitle || identity?.title || "";
  const author = series.author || identity?.author || "ukendt forfatter";
  const mmc = leadCharacters?.mmc || "";
  const candidates = unique([
    mmc,
    ...(leadCharacters?.alternatives || []).map((a) => a.name),
  ]).filter(Boolean);

  const preferSeriesOverFirstBook =
    Boolean(firstBook) &&
    firstBook.toLowerCase() !== String(seriesTitle).toLowerCase();
  const firstBit = firstBook
    ? preferSeriesOverFirstBook
      ? `\nFørste bog er "${firstBook}" — det er IKKE det primære søgeemne. Søg på serien "${seriesTitle}", ikke kun første bog.`
      : `\nTitlen "${firstBook}" er også første bog. Søg på HELE serien og senere bind, ikke kun bog 1-summaries.`
    : "";

  const candidateBit = candidates.length
    ? `\n\nMulige navne i kilderne (ikke bekræftet series-level): ${candidates.join(", ")}. Lås ikke konklusionen til ét navn uden series-level evidens.`
    : "";

  const userPrompt = `Jeg undersøger serien "${seriesTitle}" af ${author}.${firstBit}

Undersøg FØRST seriens romantiske STRUKTUR. Antag ikke ét centralt/endgame-par for hele serien.

Do not answer based only on book 1.
Search for evidence from later books or series-level guides/discussions.
Spoilers are allowed.

Find evidens for én af disse strukturer:
- samme primære romantiske par gennem det relevante serie-/arc-scope
- skiftende hovedpar pr. bog eller arc (ét legitimt primary par pr. scope)
- flere legitime pairings der overlapper eller kører parallelt
- utilstrækkelig, uklar eller modstridende evidens

Afklar:
- hvilke romantiske par der er legitime
- hvilket book- eller arc-scope hvert par tilhører
- om en tidligere love interest er en konkurrent i SAMME arc (alternative_love_interest) eller et andet legitimt hovedpar i et andet scope (another_primary_pairing)
- om en romance er secondary i scopet

Prioritér kilder om senere bind, series wiki/relationship-sider, series guides og læserdiskussioner med spoilers. Undgå kun at søge på første bogs titel.

Ét fundet par er ikke nok til at konkludere single_couple — der skal være series-level evidens for at det samme par er primært gennem det relevante scope.
Flere par er ikke automatisk rotating_couples — rotating kræver forskellige, ikke-konkurrerende book/arc-scopes.
Opdig ikke interne kilde-id'er.${candidateBit}`;

  const retrievalApproaches = buildRetrievalApproaches({
    identity,
    series,
    leadCharacters,
    strategy: "series_identity_resolution",
    purpose: "identity",
  });
  const queryHints = flattenRetrievalApproaches(retrievalApproaches);

  return {
    id: "identity-resolution-r0-1",
    strategy: "series_identity_resolution",
    round: 0,
    fields: [],
    targetFields: [],
    batchHint: "series_identity",
    purpose: "identity",
    priority: 1000,
    leadCharacters: leadCharacters || {},
    series,
    retrievalApproaches,
    queryHints,
    userPrompt,
    targetPhenomena: [
      "romantic structure",
      "central romantic pairing",
      "endgame partner",
      "eventual partner",
      "each book couple",
    ],
  };
}

function seriesContext(identity) {
  const series = String(identity?.series || "").trim();
  const title = String(identity?.title || series || "").trim();
  const firstBook =
    String(identity?.firstBook || identity?.book || "").trim() ||
    (series && title && series !== title ? title : "");
  return {
    title: series || title,
    workTitle: title,
    firstBook,
    author: identity?.author || "",
    isSeries: isSeriesAnalysis(identity),
  };
}

function groupGaps(gaps) {
  const assigned = new Set();
  const groups = [];
  const rhysandGap = gaps.find((g) => g.field === "Rhysand-faktoren");
  const heroineGap = gaps.find((g) => g.field === "Kvindelig udvikling (0-5)");

  for (const def of FOLLOWUP_STRATEGY_GROUPS) {
    let fields = def.fields;
    if (def.strategy === "heroine_growth" && rhysandGap && heroineGap) {
      fields = def.fields.filter((f) => f !== "Kvindelig udvikling (0-5)");
    }
    if (def.strategy === "hero_respect_agency" && rhysandGap && heroineGap) {
      fields = ["Rhysand-faktoren", "Kvindelig udvikling (0-5)"];
    }
    const members = gaps.filter(
      (g) => fields.includes(g.field) && !assigned.has(g.field)
    );
    if (!members.length) continue;
    members.forEach((g) => assigned.add(g.field));
    groups.push({
      strategy: def.strategy,
      batchHint: def.batchHint,
      fields: members.map((g) => g.field),
      gaps: members,
    });
  }

  const leftover = gaps.filter((g) => !assigned.has(g.field));
  for (const gap of leftover) {
    groups.push({
      strategy: "plot_worldbuilding",
      batchHint: gap.batchHint || "plotkarakter",
      fields: [gap.field],
      gaps: [gap],
    });
  }

  return groups.map((group) => {
    const highCoverageConflicts = group.gaps.every(
      (g) =>
        g.coverageScore >= ADAPTIVE_FIELD_MIN_COVERAGE &&
        g.conflictLevel === "meaningful"
    );
    const strategy = highCoverageConflicts
      ? "conflict_resolution"
      : group.strategy;
    const priority = Math.max(...group.gaps.map((g) => g.priority));
    return { ...group, strategy, priority };
  });
}

function heroLabel(leadCharacters) {
  if (leadsUnresolved(leadCharacters)) {
    return "seriens centrale mandlige romantiske lead";
  }
  if (leadCharacters.mmc) return leadCharacters.mmc;
  return "den mandlige hovedperson";
}

function heroineLabel(leadCharacters) {
  if (leadsUnresolved(leadCharacters)) return "heltinden";
  if (leadCharacters.fmc) return leadCharacters.fmc;
  return "heltinden";
}

function seriesOpener(series, identity) {
  const author = series.author || identity?.author || "ukendt forfatter";
  if (series.isSeries) {
    const seriesTitle = series.title || identity?.series || identity?.title || "serien";
    const first = series.firstBook || series.workTitle;
    const firstBit =
      first && first.toLowerCase() !== String(seriesTitle).toLowerCase()
        ? ` med første bog "${first}"`
        : "";
    return `Jeg undersøger serien "${seriesTitle}"${firstBit} af ${author}.`;
  }
  const title = series.workTitle || series.title || identity?.title || "bogen";
  return `Jeg undersøger bogen "${title}" af ${author}.`;
}

function seriesPriorityNote(series) {
  if (!series.isSeries) return "";
  return `

Prioritér den centrale romantiske dynamik på tværs af serien, ikke blot den første tilsyneladende love interest i bog 1. Spoilers er tilladt i intern research.`;
}

function candidateNote(leadCharacters) {
  if (!leadsUnresolved(leadCharacters)) return "";
  const names = unique([
    leadCharacters.mmc,
    leadCharacters.fmc,
    ...(leadCharacters.alternatives || []).map((a) => a.name),
  ]).filter(Boolean);
  if (!names.length) return "";
  return `

Mulige navne i kilderne (usikkert hvem der er series-level lead): ${names.join(", ")}. Lås ikke researchen til ét navn. Brug gerne "seriens centrale mandlige romantiske lead" / "heltindens eventual romantiske partner".`;
}

function buildUserPrompt({ strategy, group, identity, leadCharacters, series }) {
  const title = series.title || identity?.title || "serien";
  const opener = seriesOpener(series, identity);
  const mmc = heroLabel(leadCharacters);
  const fmc = heroineLabel(leadCharacters);
  const lacking = unique(group.gaps.flatMap((g) => g.targetPhenomena)).slice(0, 6);
  const fieldLabels = group.fields.join(", ");
  const extra = seriesPriorityNote(series) + candidateNote(leadCharacters);

  const avoid = `Prioritér kilder der beskriver karakteradfærd direkte.

Undgå:
- forlagsbeskrivelser
- katalog-/salgssider
- generisk synopsis
- listicles der kun nævner tropes uden forklaring
- study guides som eneste belæg for subjektive tropes`;

  if (strategy === "conflict_resolution") {
    return `${opener}

Kilder er uenige om dynamikken mellem ${mmc} og ${fmc} i "${title}".

Find yderligere uafhængige læserdiskussioner og detaljerede anmeldelser der specifikt behandler: ${fieldLabels}.

Vi har allerede evidens, men den peger i forskellige retninger. Find kilder der konkret beskriver adfærden — ikke bare trope-labels.
${extra}

${avoid}`;
  }

  if (strategy === "hero_protective_dynamic") {
    return `${opener}

Find læseranmeldelser, forumtråde og detaljerede reviews der specifikt beskriver hvordan ${mmc} reagerer når ${fmc} er i fare.

Vi mangler i øjeblikket direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
  }

  if (strategy === "hero_respect_agency") {
    return `${opener}

Find læseranmeldelser og diskussioner der beskriver om ${mmc} respekterer ${fmc}s handlekraft og udvikling.

Vi mangler direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
  }

  if (strategy === "heroine_growth") {
    return `${opener}

Find detaljerede anmeldelser der beskriver ${fmc}s udvikling og karakterbue.

Vi mangler direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
  }

  if (strategy === "romance_spice") {
    return `${opener}

Find læseranmeldelser der konkret beskriver romance-fokus og spice i "${title}" — niveau, kvalitet og om scenerne er open door eller fade to black.

Vi mangler direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
  }

  if (strategy === "reader_emotional_response") {
    return `${opener}

Find læserreaktioner på "${title}" der beskriver pacing og om bogen giver book hangover — ikke bare stjerner.

Vi mangler direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
  }

  return `${opener}

Find dybdegående anmeldelser af "${title}" der konkret belyser: ${fieldLabels}.

Vi mangler direkte evidens for:
${lacking.map((p) => `- ${p}`).join("\n")}
${extra}

${avoid}`;
}

export function planFollowUpResearch({
  identity,
  research,
  assessments,
  coverage,
  gaps,
  round = 1,
  maxJobs = ADAPTIVE_MAX_JOBS_PER_ROUND,
  previousRounds = [],
} = {}) {
  const resolvedCoverage =
    coverage ||
    calculateResearchCoverage({ assessments, research, identity });
  const resolvedGaps =
    gaps ||
    detectResearchGaps({
      coverage: resolvedCoverage,
      assessments,
      research,
    });

  const meaningfulConflict = resolvedGaps.some(
    (g) => g.conflictLevel === "meaningful"
  );
  if (
    resolvedCoverage.weightedCoverage >= ADAPTIVE_TARGET_COVERAGE &&
    resolvedCoverage.criticalFieldsBelowMinimum.length === 0 &&
    !(resolvedCoverage.criticalFieldsMissingStopQuality || []).length &&
    !meaningfulConflict
  ) {
    return [];
  }
  if (!resolvedGaps.length) return [];

  const leadCharacters = softLeadCharacters(research, identity);
  const series = seriesContext(identity);
  const actionableGaps = resolvedGaps.filter((gap) =>
    fieldStillNeedsFollowUp(gap, resolvedCoverage.fields?.[gap.field])
  );
  if (!actionableGaps.length) return [];

  const groups = groupGaps(actionableGaps).sort(
    (a, b) => b.priority - a.priority
  );
  const limit = Math.max(0, Number(maxJobs) || 0);

  const priorStrategies = new Set(
    (previousRounds || []).flatMap((r) =>
      (r.jobs || []).map((j) => j.strategy).filter(Boolean)
    )
  );

  const plannedSemanticPairingKeys = new Set();

  return groups.slice(0, limit).map((group, i) => {
    const usedBefore = priorStrategies.has(group.strategy);
    const fieldNeeds = group.fields.map((field) =>
      classifyFieldResearchNeed(resolvedCoverage.fields?.[field] || { field })
    );
    const retrievalMode = selectGroupRetrievalMode(fieldNeeds);
    const preferredSourceRoles = unique(
      fieldNeeds.flatMap((n) => n.preferredSourceRoles || [])
    );
    const targetFields = group.fields;
    const romanceScope = selectRomanceScopeForJob({
      seriesRomanceIdentity: research?.seriesRomanceIdentity,
      strategy: group.strategy,
      targetFields,
      previousRounds,
      plannedSemanticPairingKeys,
    });
    if (romanceScope) {
      plannedSemanticPairingKeys.add(semanticPairingKey(romanceScope));
    }
    let userPrompt = buildUserPrompt({
      strategy: group.strategy,
      group,
      identity,
      leadCharacters,
      series,
    });
    if (usedBefore) {
      userPrompt += `

En tidligere researchrunde søgte allerede på denne dynamik. Prioritér andre communities (Reddit, Goodreads-diskussioner, uafhængige blogs) og andre synonymer. Gentag ikke de samme katalog- eller synopsis-kilder.`;
    }
    const modeNote = retrievalModeInstruction(retrievalMode);
    if (modeNote) userPrompt += `\n\n${modeNote}`;
    const retrievalApproaches = buildRetrievalApproaches({
      identity,
      series,
      leadCharacters,
      targetFields: group.fields,
      strategy: group.strategy,
      purpose: "field",
      retrievalMode,
    });
    return {
      id: `followup-${group.strategy}-r${round}-${i + 1}`,
      strategy: group.strategy,
      round,
      fields: group.fields,
      targetFields: group.fields,
      batchHint: group.batchHint,
      priority: group.priority,
      reasons: unique(group.gaps.flatMap((g) => g.reasons)),
      leadCharacters,
      series,
      retrievalApproaches,
      queryHints: flattenRetrievalApproaches(retrievalApproaches, retrievalMode),
      userPrompt,
      targetPhenomena: unique(group.gaps.flatMap((g) => g.targetPhenomena)),
      previousStrategyUsed: usedBefore,
      retrievalMode,
      preferredSourceRoles,
      fieldNeeds,
      romanceScope: romanceScope ?? null,
    };
  });
}

export function summarizeAdaptiveIntelligence(result, { topN = 5 } = {}) {
  const gaps = result?.gaps || [];
  const fields = result?.coverage?.fields || {};
  const criticalFieldEvidence = {};
  for (const [field, cov] of Object.entries(fields)) {
    if (!isCriticalTineField(field)) continue;
    criticalFieldEvidence[field] = cov.evidenceDebug || {
      coverage: cov.coverageScore,
      stopQualitySatisfied: cov.stopQualitySatisfied,
    };
  }
  return {
    weightedCoverage: result?.coverage?.weightedCoverage ?? 0,
    criticalFieldsBelowMinimum:
      result?.coverage?.criticalFieldsBelowMinimum || [],
    criticalFieldsMissingStopQuality:
      result?.coverage?.criticalFieldsMissingStopQuality || [],
    criticalFieldEvidence,
    topGaps: gaps.slice(0, topN).map((g) => ({
      field: g.field,
      coverageScore: g.coverageScore,
      priority: g.priority,
    })),
    proposedJobs: result?.followUpPlan || [],
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

export function analyzeResearchNeeds({
  identity,
  research,
  assessments,
  previousRounds = [],
} = {}) {
  const leadCharacters = softLeadCharacters(research, identity);
  const coverage = calculateResearchCoverage({
    assessments,
    research,
    identity,
    leadCharacters,
  });
  const gaps = detectResearchGaps({ coverage, assessments, research });
  const followUpPlan = planFollowUpResearch({
    identity,
    research,
    assessments,
    coverage,
    gaps,
    round: (previousRounds?.length || 0) + 1,
    previousRounds,
  });

  return {
    coverage,
    gaps,
    followUpPlan,
    debug: summarizeAdaptiveIntelligence({ coverage, gaps, followUpPlan }),
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

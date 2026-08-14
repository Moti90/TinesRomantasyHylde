/**
 * Research-quality benchmark (Bid 3 Fase A).
 * Pure scoring/reporting — no OpenAI, no production-threshold changes.
 * Coverage is treated as a hypothesis to test, not as ground truth.
 */

import {
  analyzeResearchNeeds,
  calculateEvidenceDiversity,
  isNearDuplicateSource,
  softLeadCharacters,
  sourceIdentityKey,
  subjectiveSourceQuality,
} from "./adaptiveResearch.js";
import {
  SUBJECTIVE_KEYS,
  getTineFieldWeight,
  isCriticalTineField,
} from "./decisionScores.js";
import {
  canonicalizeUrl,
  classifySourceType,
} from "./webResearch.js";
import {
  evaluateSourceForField,
  evaluateSourcesForFields,
  isFieldSpecificEvidence,
} from "./evidenceRelevance.js";
import {
  FIELD_MATCH_ALTERNATIVE_CHARACTER,
  FIELD_MATCH_WRONG_SUBJECT,
  MMC_BOUND_FIELDS,
  namesReferToSamePerson,
  subjectIdentityFrom,
} from "./sourceSubject.js";

export const BENCHMARK_VERSION = "benchmark-v4";

export const FAILURE_FLAGS = [
  "NO_EVIDENCE_FOUND",
  "IRRELEVANT_EVIDENCE",
  "LOW_SOURCE_DIVERSITY",
  "DUPLICATE_HEAVY",
  "PUBLISHER_HEAVY",
  "PREMATURE_STOP",
  "OVERCONFIDENT_COVERAGE",
  "UNDERCONFIDENT_COVERAGE",
  "CONFLICT_UNRESOLVED",
  "CHARACTER_IDENTIFICATION_FAILURE",
  "CHARACTER_IDENTIFICATION_UNRESOLVED",
  "QUERY_LOW_YIELD",
  "TOO_EXPENSIVE",
  "WRONG_SUBJECT_EVIDENCE",
];

const RELEVANT_LABELS = new Set(["relevant", "strong", "yes", "true"]);
const IRRELEVANT_LABELS = new Set(["irrelevant", "weak", "no", "false"]);

function unique(arr) {
  return [...new Set((arr || []).filter((v) => v != null && v !== ""))];
}

function uniqueByIdentity(sources = []) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const key = sourceIdentityKey(s) || s.id || JSON.stringify(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function round4(n) {
  if (n == null || Number.isNaN(n)) return n;
  return Math.round(n * 10000) / 10000;
}

function assessmentsOf(analysis) {
  return analysis?.meta?.assessments || analysis?.assessments || {};
}

export function evidenceLookupKeys(source) {
  if (!source) return [];
  return unique([
    source.id,
    sourceIdentityKey(source),
    canonicalizeUrl(source.url),
    source.url,
  ]);
}

export function lookupEvidenceLabel(source, labels = {}) {
  if (!source || !labels || typeof labels !== "object") return null;
  for (const key of evidenceLookupKeys(source)) {
    if (labels[key] != null && labels[key] !== "") return String(labels[key]);
  }
  return null;
}

export function isLabelRelevant(label) {
  if (label == null) return null;
  const v = String(label).toLowerCase();
  if (RELEVANT_LABELS.has(v)) return true;
  if (IRRELEVANT_LABELS.has(v)) return false;
  return null;
}

export function benchmarkSourceClass(source) {
  const type =
    source?.type ||
    classifySourceType(source?.url, source?.title, source?.type);
  const blob = `${source?.title || ""} ${source?.url || ""}`.toLowerCase();
  if (
    /listicle|best \d+|books like |tiktok made me|rankings of|every romantasy/i.test(
      blob
    )
  ) {
    return "seo_listicle";
  }
  if (type === "forum") return "reader_community";
  if (type === "goodreads") return "goodreads";
  if (type === "blog") return "review_blog";
  if (type === "professional") return "professional_review";
  if (type === "official") return "official";
  if (type === "catalog") return "catalog";
  if (type === "publisher") return "publisher";
  return "unknown";
}

export function sourceTypeDistribution(sources = []) {
  const counts = {};
  for (const s of sources) {
    const cls = benchmarkSourceClass(s);
    counts[cls] = (counts[cls] || 0) + 1;
  }
  const total = sources.length || 1;
  const shares = {};
  for (const [k, v] of Object.entries(counts)) {
    shares[k] = round4(v / total);
  }
  return { counts, shares, total: sources.length };
}

export function independenceReport(sources = []) {
  const diversity = calculateEvidenceDiversity(sources);
  const keys = sources.map((s) => sourceIdentityKey(s)).filter(Boolean);
  const uniqueKeys = new Set(keys);
  const duplicateRate = keys.length
    ? round4(1 - uniqueKeys.size / keys.length)
    : 0;
  let nearDupes = 0;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if (isNearDuplicateSource(sources[i], sources[j])) nearDupes += 1;
    }
  }
  return {
    uniqueUrls: diversity.uniqueUrls,
    uniqueDomains: diversity.uniqueDomains,
    sourceTypes: diversity.sourceTypes,
    dominantDomainShare: round4(diversity.dominantDomainShare),
    independentIdentities: diversity.independentIdentities,
    duplicateRate,
    nearDuplicatePairs: nearDupes,
    nearDuplicateRate: sources.length
      ? round4(nearDupes / Math.max(1, sources.length))
      : 0,
  };
}

export function heuristicRelevantSources(sources = []) {
  return (sources || []).filter((s) => {
    const cls = benchmarkSourceClass(s);
    if (["catalog", "publisher", "official", "seo_listicle"].includes(cls)) {
      return false;
    }
    return subjectiveSourceQuality(s) >= 0.5;
  });
}

export function resolveEvidenceSources(assessment, research) {
  const ids = assessment?.evidenceSourceIds || [];
  const byId = new Map((research?.sources || []).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function calculateEvidencePrecision({
  field,
  assessment,
  research,
  labels,
} = {}) {
  const sources = resolveEvidenceSources(assessment, research);
  const fieldLabels = labels || {};
  if (!sources.length) {
    return {
      field,
      precision: null,
      labeledCount: 0,
      unlabeledCount: 0,
      relevantCount: 0,
      usedCount: 0,
    };
  }
  let labeledCount = 0;
  let relevantCount = 0;
  let unlabeledCount = 0;
  for (const s of sources) {
    const raw = lookupEvidenceLabel(s, fieldLabels);
    const rel = isLabelRelevant(raw);
    if (rel == null) unlabeledCount += 1;
    else {
      labeledCount += 1;
      if (rel) relevantCount += 1;
    }
  }
  return {
    field,
    precision: labeledCount ? round4(relevantCount / labeledCount) : null,
    labeledCount,
    unlabeledCount,
    relevantCount,
    usedCount: sources.length,
  };
}

export function calculateReferenceRecall({
  field,
  research,
  referenceEvidence = [],
} = {}) {
  const refs = (referenceEvidence || []).filter((r) => r?.url);
  if (!refs.length) {
    return { field, recall: null, referenceCount: 0, foundCount: 0 };
  }
  const appKeys = new Set(
    (research?.sources || []).flatMap((s) => evidenceLookupKeys(s))
  );
  let foundCount = 0;
  for (const ref of refs) {
    const probe = { url: ref.url, id: ref.id };
    const keys = evidenceLookupKeys(probe);
    if (keys.some((k) => appKeys.has(k))) foundCount += 1;
  }
  return {
    field,
    recall: round4(foundCount / refs.length),
    referenceCount: refs.length,
    foundCount,
  };
}

function criticalCoverageOf(coverage) {
  const crit = SUBJECTIVE_KEYS.filter((k) => isCriticalTineField(k));
  if (!crit.length) return 0;
  const sum = crit.reduce(
    (acc, k) => acc + (coverage.fields?.[k]?.coverageScore || 0),
    0
  );
  return Math.round(sum / crit.length);
}

export function snapshotMetrics({ research, analysis, identity } = {}) {
  const assessments = assessmentsOf(analysis);
  const intelligence = analyzeResearchNeeds({
    identity,
    research,
    assessments,
  });
  const sources = research?.sources || [];
  const heuristic = heuristicRelevantSources(sources);
  return {
    sourceCount: sources.length,
    relevantSourceCount: heuristic.length,
    weightedCoverage: intelligence.coverage.weightedCoverage,
    criticalCoverage: criticalCoverageOf(intelligence.coverage),
    criticalFieldsBelowMinimum:
      intelligence.coverage.criticalFieldsBelowMinimum || [],
    costUsd: Number(research?.meta?.estimatedCostUsd) || 0,
    intelligence,
    typeDistribution: sourceTypeDistribution(sources),
    independence: independenceReport(sources),
  };
}

export function fieldBenchmark({
  field,
  initialResearch,
  finalResearch,
  initialAnalysis,
  finalAnalysis,
  groundField,
  identity,
} = {}) {
  const initialAssess = assessmentsOf(initialAnalysis)[field];
  const finalAssess = assessmentsOf(finalAnalysis)[field];
  const initialCov = analyzeResearchNeeds({
    identity,
    research: initialResearch,
    assessments: assessmentsOf(initialAnalysis),
  }).coverage.fields[field];
  const finalCov = analyzeResearchNeeds({
    identity,
    research: finalResearch,
    assessments: assessmentsOf(finalAnalysis),
  }).coverage.fields[field];

  const labels = groundField?.evidenceLabels || {};
  const precision = calculateEvidencePrecision({
    field,
    assessment: finalAssess,
    research: finalResearch,
    labels,
  });
  const recall = calculateReferenceRecall({
    field,
    research: finalResearch,
    referenceEvidence: groundField?.referenceEvidence,
  });

  const initialIds = new Set(initialAssess?.evidenceSourceIds || []);
  const addedIds = (finalAssess?.evidenceSourceIds || []).filter(
    (id) => !initialIds.has(id)
  );

  const heuristic = heuristicFieldEvidenceRelevance({
    field,
    assessment: finalAssess,
    research: finalResearch,
  });

  return {
    field,
    tineWeight: getTineFieldWeight(field),
    critical: isCriticalTineField(field),
    score: finalAssess?.score ?? null,
    confidence: finalAssess?.confidence || null,
    basis: finalAssess?.basis || null,
    initialCoverage: initialCov?.coverageScore ?? 0,
    finalCoverage: finalCov?.coverageScore ?? 0,
    coverageGain: (finalCov?.coverageScore || 0) - (initialCov?.coverageScore || 0),
    conflictLevel: finalCov?.conflictLevel || "none",
    evidenceSourceIds: finalAssess?.evidenceSourceIds || [],
    addedEvidenceIds: addedIds,
    evidencePrecision: precision.precision,
    precisionDetail: precision,
    referenceRecall: recall.recall,
    recallDetail: recall,
    heuristicEvidenceRelevance: heuristic,
    expectedRange: groundField?.expectedRange || null,
    notes: groundField?.notes || null,
  };
}

export function heuristicFieldEvidenceRelevance({
  field,
  assessment,
  research,
} = {}) {
  const sources = resolveEvidenceSources(assessment, research);
  if (!sources.length) {
    return {
      field,
      citedCount: 0,
      fieldSpecificCount: 0,
      ratio: null,
      byLevel: { direct: 0, supporting: 0, contextual: 0, none: 0 },
    };
  }
  const { byField } = evaluateSourcesForFields({
    sources,
    fields: [field],
    assessments: { [field]: assessment },
    context: {
      research,
      leadCharacters: research?.seriesIdentity,
      ...subjectIdentityFrom(research, {}, { leadCharacters: research?.seriesIdentity }),
    },
  });
  const evs = byField[field] || [];
  const byLevel = { direct: 0, supporting: 0, contextual: 0, none: 0 };
  for (const ev of evs) {
    if (byLevel[ev.relevance] != null) byLevel[ev.relevance] += 1;
  }
  const fieldSpecificCount = evs.filter(isFieldSpecificEvidence).length;
  return {
    field,
    citedCount: sources.length,
    fieldSpecificCount,
    ratio: round4(fieldSpecificCount / sources.length),
    byLevel,
  };
}

function namesMatch(expected, actual) {
  if (!expected) return null;
  if (!actual) return false;
  return namesReferToSamePerson(expected, actual);
}

export function collectWrongSubjectEvidence({
  research,
  identity,
  leadCharacters,
} = {}) {
  const sources = research?.sources || [];
  const ctxIdentity = subjectIdentityFrom(research, identity || {}, {
    leadCharacters: leadCharacters || research?.seriesIdentity,
  });
  const examples = [];
  if (!ctxIdentity.mmc && !ctxIdentity.fmc) {
    return { wrongSubjectEvidenceCount: 0, examples };
  }
  const context = {
    research,
    identity,
    leadCharacters: leadCharacters || research?.seriesIdentity,
    ...ctxIdentity,
  };
  const fields = [...MMC_BOUND_FIELDS];
  for (const source of sources) {
    if (source?.purpose === "identity") continue;
    for (const field of fields) {
      const ev = evaluateSourceForField({ source, field, context });
      const rawSpecific = ["direct", "supporting"].includes(ev.rawRelevance);
      const validatedNone = !isFieldSpecificEvidence(ev);
      const reason = ev.subjectRejectionReason;
      if (
        rawSpecific &&
        validatedNone &&
        (reason === FIELD_MATCH_ALTERNATIVE_CHARACTER ||
          reason === FIELD_MATCH_WRONG_SUBJECT)
      ) {
        examples.push({
          sourceId: source.id || null,
          field,
          detectedSubject:
            ev.subject?.subjectStatus ||
            (ev.subject?.alternativeMentions || []).map((a) => a.name).join(",") ||
            "alternative",
          targetSubject: ctxIdentity.mmc || "",
        });
      }
    }
  }
  return {
    wrongSubjectEvidenceCount: examples.length,
    examples: examples.slice(0, 12),
  };
}

export function validateCharacters({
  identity,
  research,
  expectedCharacters,
  jobs = [],
  identityAfter = null,
  identityBefore = null,
} = {}) {
  const inferred = softLeadCharacters(research, identity);
  const after = identityAfter || null;
  const comparison = after || inferred;
  const used = jobs[0]?.leadCharacters || after || inferred;
  const expected = expectedCharacters || {};
  const afterUnresolved =
    after &&
    (after.resolved === false ||
      (!after.mmc && Boolean(expected.mmc)));

  let status = "unknown";
  if (afterUnresolved && (expected.mmc || expected.fmc)) {
    status = "unresolved";
  } else if (expected.mmc || expected.fmc) {
    const mmcOk = namesMatch(expected.mmc, comparison.mmc);
    const fmcOk = namesMatch(expected.fmc, comparison.fmc);
    const checks = [mmcOk, fmcOk].filter((v) => v != null);
    status = checks.length && checks.every(Boolean) ? "match" : "mismatch";
  }
  return {
    inferred,
    usedInQueries: used,
    expected,
    status,
    identityBefore: identityBefore || null,
    identityAfter: after,
  };
}

export function queryEffectiveness(rounds = [], jobs = []) {
  return (rounds || []).map((round) => {
    const roundJobs = (jobs || []).filter((j) => Number(j.round) === Number(round.round));
    const calls = Number(round.webSearchCalls) || 0;
    const relevant = Number(round.newRelevantSources) || 0;
    const gain = Number(round.coverageGain) || 0;
    const cost = Number(round.costUsd) || 0;
    const jobRows = round.jobs || [];
    const attempts = jobRows.flatMap((j) => j.retrievalAttempts || []);
    const primaryAttempt = attempts.find((a) => a.attempt === 1);
    const fallbackAttempt = attempts.find((a) => a.attempt === 2);
    const rawUrlsPrimary = jobRows.reduce((n, j) => {
      const a = (j.retrievalAttempts || []).find((x) => x.attempt === 1);
      return n + (Number(a?.rawUrlCount ?? (j.rawUrlCount || 0)) || 0);
    }, 0);
    const rawUrlsFallback = jobRows.reduce((n, j) => {
      const a = (j.retrievalAttempts || []).find((x) => x.attempt === 2);
      return n + (Number(a?.rawUrlCount) || 0);
    }, 0);
    const uniqueSources = Number(round.newSources) || 0;
    const preparedSources = jobRows.reduce(
      (n, j) => n + (Number(j.preparedCount ?? j.sourceCount) || 0),
      0
    );
    const direct = Number(round.evidenceTrace?.directCount) || 0;
    const supporting = Number(round.evidenceTrace?.supportingCount) || 0;
    const contextual = Number(round.evidenceTrace?.contextualCount) || 0;
    return {
      round: round.round,
      strategy: jobRows.map((j) => j.strategy),
      targetFields: round.targetFields || [],
      jobs: roundJobs.length ? roundJobs : jobRows,
      webSearchCalls: calls,
      searchCalls: calls,
      sourcesReturned: uniqueSources,
      uniqueSourcesAdded: uniqueSources,
      relevantSourcesAdded: relevant,
      coverageGain: gain,
      criticalFieldsResolved: round.criticalFieldsResolved || [],
      costUsd: cost,
      searchCostUsd: jobRows.reduce(
        (n, j) => n + (Number(j.totalSearchCostUsd) || 0),
        0
      ),
      relevantSourcesPerSearchCall: calls ? round4(relevant / calls) : null,
      coverageGainPerSearchCall: calls ? round4(gain / calls) : null,
      coverageGainPerDollar: cost ? round4(gain / cost) : null,
      retrievalAttempts: attempts,
      rawUrlsPrimary: primaryAttempt ? Number(primaryAttempt.rawUrlCount) || 0 : rawUrlsPrimary,
      rawUrlsFallback: fallbackAttempt ? Number(fallbackAttempt.rawUrlCount) || 0 : rawUrlsFallback,
      uniqueSources,
      duplicateSources: Math.max(0, rawUrlsPrimary + rawUrlsFallback - uniqueSources),
      preparedSources,
      directEvidence: direct,
      supportingEvidence: supporting,
      contextualEvidence: contextual,
      newRelevantSources: relevant,
      fallbackTriggered: Boolean(round.fallbackTriggered),
      fallbackRecovered: Boolean(round.fallbackRecovered),
      retrievalStatus: round.retrievalStatus || null,
      evidenceOutcome: round.evidenceOutcome || null,
    };
  });
}

export function summarizeRetrieval(adaptiveMeta = {}) {
  const jobs = [];
  const identity = adaptiveMeta.identityResolution || {};
  if (identity.triggered || (identity.retrievalAttempts || []).length) {
    jobs.push({
      retrievalAttempts: identity.retrievalAttempts || [],
      retrievalStatus: identity.retrievalStatus || null,
      webSearchCalls: identity.searchCalls || 0,
      fallbackTriggered: Boolean(identity.fallbackTriggered),
      totalSearchCostUsd: identity.totalSearchCostUsd ?? identity.costUsd,
    });
  }
  for (const round of adaptiveMeta.rounds || []) {
    for (const j of round.jobs || []) {
      jobs.push({
        ...j,
        evidenceOutcome: round.evidenceOutcome,
        newRelevantSources: round.newRelevantSources,
        evidenceTrace: round.evidenceTrace,
      });
    }
  }
  const n = jobs.length;
  const zero = jobs.filter((j) => j.retrievalStatus === "retrieval_zero").length;
  const fallbacks = jobs.filter(
    (j) =>
      Boolean(j.fallbackTriggered) ||
      (j.retrievalAttempts || []).some((a) => a.attempt === 2)
  ).length;
  const recovered = jobs.filter((j) => j.retrievalStatus === "fallback_recovered").length;
  const searchCalls = jobs.reduce((acc, j) => acc + (Number(j.webSearchCalls) || 0), 0);
  const relevant = (adaptiveMeta.rounds || []).reduce(
    (acc, r) => acc + (Number(r.newRelevantSources) || 0),
    0
  );
  const directSupporting = (adaptiveMeta.rounds || []).reduce((acc, r) => {
    const t = r.evidenceTrace || {};
    return acc + (Number(t.directCount) || 0) + (Number(t.supportingCount) || 0);
  }, 0);
  const searchCost = jobs.reduce(
    (acc, j) => acc + (Number(j.totalSearchCostUsd) || 0),
    0
  );
  return {
    jobCount: n,
    zeroRetrievalRate: n ? round4(zero / n) : null,
    fallbackRate: n ? round4(fallbacks / n) : null,
    fallbackRecoveryRate: fallbacks ? round4(recovered / fallbacks) : null,
    evidencePerSearchCall: searchCalls ? round4(relevant / searchCalls) : null,
    directSupportingPerSearchCall: searchCalls
      ? round4(directSupporting / searchCalls)
      : null,
    costPerRelevantSource: relevant ? round4(searchCost / relevant) : null,
    searchCalls,
    searchCostUsd: round4(searchCost),
  };
}

export function costReport({ baseline, adaptiveMeta } = {}) {
  const initial =
    Number(adaptiveMeta?.initialResearchCostUsd) ||
    Number(baseline?.costUsd) ||
    0;
  const additional = Number(adaptiveMeta?.additionalCostUsd) || 0;
  const total =
    Number(adaptiveMeta?.totalResearchCostUsd) ||
    round4(initial + additional);
  const addedRelevant = (adaptiveMeta?.rounds || []).reduce(
    (acc, r) => acc + (Number(r.newRelevantSources) || 0),
    0
  );
  const coverageGain =
    (Number(adaptiveMeta?.finalCoverage) || 0) -
    (Number(adaptiveMeta?.initialCoverage) || 0);
  return {
    initialResearchCostUsd: round4(initial),
    adaptiveAdditionalCostUsd: round4(additional),
    adaptiveSplit: {
      searchSynthesisAnalysis: round4(additional),
      note: "estimate — Bid 2 stores combined adaptive extra cost",
    },
    totalCostUsd: round4(total),
    costPerUsefulAddedSource: addedRelevant
      ? round4(additional / addedRelevant)
      : null,
    costPerTenCoverage:
      coverageGain > 0 ? round4((additional / coverageGain) * 10) : null,
  };
}

export function detectFailureFlags({
  baseline,
  adaptive,
  fields = [],
  characters,
  adaptiveMeta,
  remainingGaps,
  wrongSubjectEvidence,
} = {}) {
  const flags = [];
  const push = (code, detail, requiresHumanReview = false) => {
    flags.push({ code, detail, requiresHumanReview });
  };

  const finalSources = adaptive?.research?.sources || [];
  const evidenceAll = uniqueByIdentity(
    fields.flatMap((f) =>
      resolveEvidenceSources(
        assessmentsOf(adaptive?.analysis)[f.field],
        adaptive?.research
      )
    )
  );
  const dist = sourceTypeDistribution(evidenceAll.length ? evidenceAll : finalSources);
  const independence = independenceReport(
    evidenceAll.length ? evidenceAll : finalSources
  );

  const noEvidenceFields = fields.filter(
    (f) =>
      f.critical &&
      (f.finalCoverage || 0) < 25 &&
      !(f.evidenceSourceIds || []).length
  );
  if (noEvidenceFields.length) {
    push(
      "NO_EVIDENCE_FOUND",
      noEvidenceFields.map((f) => f.field).join(", ")
    );
  }

  const irrelevant = fields.filter(
    (f) => f.evidencePrecision != null && f.evidencePrecision < 0.5
  );
  if (irrelevant.length) {
    push(
      "IRRELEVANT_EVIDENCE",
      irrelevant.map((f) => `${f.field}=${f.evidencePrecision}`).join("; ")
    );
  } else if (fields.some((f) => f.evidencePrecision == null && (f.finalCoverage || 0) >= 70)) {
    push(
      "IRRELEVANT_EVIDENCE",
      "high coverage without human relevance labels",
      true
    );
  }

  if (
    independence.uniqueDomains <= 1 &&
    (evidenceAll.length || finalSources.length) >= 3
  ) {
    push("LOW_SOURCE_DIVERSITY", `uniqueDomains=${independence.uniqueDomains}`);
  }
  if (independence.duplicateRate >= 0.25) {
    push("DUPLICATE_HEAVY", `duplicateRate=${independence.duplicateRate}`);
  }

  const pubShare =
    (dist.shares.publisher || 0) +
    (dist.shares.catalog || 0) +
    (dist.shares.official || 0);
  if (pubShare >= 0.5 && (evidenceAll.length || 0) >= 2) {
    push("PUBLISHER_HEAVY", `publisher/catalog/official share=${pubShare}`);
  }

  const stopReason = adaptiveMeta?.stopReason;
  const remainingCritical = adaptive?.metrics?.criticalFieldsBelowMinimum || [];
  const remainingConflicts = (remainingGaps || []).filter(
    (g) => g.conflictLevel === "meaningful"
  );
  const weakRecall = fields.filter(
    (f) => f.critical && f.referenceRecall != null && f.referenceRecall < 0.5
  );
  if (
    (stopReason === "target_reached" || stopReason === "no_gaps") &&
    (remainingCritical.length || remainingConflicts.length || weakRecall.length)
  ) {
    push(
      "PREMATURE_STOP",
      `stop=${stopReason}; criticalLeft=${remainingCritical.length}; conflicts=${remainingConflicts.length}`
    );
  }

  const over = fields.filter(
    (f) =>
      (f.finalCoverage || 0) >= 80 &&
      f.evidencePrecision != null &&
      f.evidencePrecision < 0.6
  );
  if (over.length) {
    push(
      "OVERCONFIDENT_COVERAGE",
      over.map((f) => `${f.field} cov=${f.finalCoverage} prec=${f.evidencePrecision}`).join("; ")
    );
  }

  const under = fields.filter(
    (f) =>
      (f.finalCoverage || 0) < 50 &&
      f.evidencePrecision != null &&
      f.evidencePrecision >= 0.9 &&
      f.referenceRecall != null &&
      f.referenceRecall >= 0.75
  );
  if (under.length) {
    push(
      "UNDERCONFIDENT_COVERAGE",
      under.map((f) => f.field).join(", ")
    );
  }

  if (remainingConflicts.length) {
    push(
      "CONFLICT_UNRESOLVED",
      remainingConflicts.map((g) => g.field).join(", ")
    );
  }

  if (characters?.status === "unresolved") {
    push(
      "CHARACTER_IDENTIFICATION_UNRESOLVED",
      `expected ${JSON.stringify(characters.expected)} identityAfter ${JSON.stringify(characters.identityAfter || {})}`
    );
  } else if (characters?.status === "mismatch") {
    push(
      "CHARACTER_IDENTIFICATION_FAILURE",
      `expected ${JSON.stringify(characters.expected)} identityAfter ${JSON.stringify(characters.identityAfter || characters.inferred)}`
    );
  }

  const lowYield = (adaptiveMeta?.rounds || []).filter(
    (r) => (r.webSearchCalls || 0) > 0 && (r.newRelevantSources || 0) === 0
  );
  if (lowYield.length) {
    push("QUERY_LOW_YIELD", `${lowYield.length} round(s) with 0 relevant sources`);
  }

  const extra = Number(adaptiveMeta?.additionalCostUsd) || 0;
  const gain =
    (Number(adaptive?.metrics?.weightedCoverage) || 0) -
    (Number(baseline?.weightedCoverage) || 0);
  const useful = (adaptiveMeta?.rounds || []).reduce(
    (acc, r) => acc + (Number(r.newRelevantSources) || 0),
    0
  );
  if (extra >= 0.2 && useful === 0 && gain < 3) {
    push("TOO_EXPENSIVE", `extra=$${extra} usefulAdded=${useful} gain=${gain}`);
  }

  const wrong =
    wrongSubjectEvidence ||
    collectWrongSubjectEvidence({
      research: adaptive?.research,
      identity: adaptive?.identity,
      leadCharacters: adaptive?.research?.seriesIdentity,
    });
  if ((wrong.wrongSubjectEvidenceCount || 0) > 0) {
    push(
      "WRONG_SUBJECT_EVIDENCE",
      `${wrong.wrongSubjectEvidenceCount} field-relevant source(s) bound to the wrong character`
    );
  }

  return flags;
}

export function compareBaselineAdaptive(baseline, adaptive) {
  return {
    sourceCountDelta: (adaptive.sourceCount || 0) - (baseline.sourceCount || 0),
    relevantSourceCountDelta:
      (adaptive.relevantSourceCount || 0) - (baseline.relevantSourceCount || 0),
    weightedCoverageDelta:
      (adaptive.weightedCoverage || 0) - (baseline.weightedCoverage || 0),
    criticalCoverageDelta:
      (adaptive.criticalCoverage || 0) - (baseline.criticalCoverage || 0),
    costDelta: round4((adaptive.costUsd || 0) - (baseline.costUsd || 0)),
    improvedCriticalCoverage:
      (adaptive.criticalCoverage || 0) > (baseline.criticalCoverage || 0),
    improvedRelevantSources:
      (adaptive.relevantSourceCount || 0) > (baseline.relevantSourceCount || 0),
  };
}

function formatSourceLine(source, i) {
  const cls = benchmarkSourceClass(source);
  const url = canonicalizeUrl(source.url) || source.url || "(no url)";
  const summary = String(source.summary || "").replace(/\s+/g, " ").slice(0, 220);
  return `[${i + 1}] ${cls} (${source.id || "?"})\n${summary}\n${url}`;
}

export function renderReviewMarkdown(result) {
  const lines = [];
  const title =
    result.identity?.series || result.identity?.title || result.id || "Unknown";
  lines.push(`# SERIES: ${title}`);
  lines.push("");
  lines.push(`Category: ${result.category || "n/a"}`);
  lines.push(`Mode: ${result.mode || "offline"}`);
  lines.push("");
  lines.push("## BASELINE vs ADAPTIVE");
  lines.push("");
  lines.push(
    `BASELINE — sources: ${result.baseline.sourceCount}, weighted coverage: ${result.baseline.weightedCoverage}, critical coverage: ${result.baseline.criticalCoverage}, cost: $${result.cost.initialResearchCostUsd}`
  );
  lines.push(
    `ADAPTIVE — sources: ${result.adaptive.sourceCount}, weighted coverage: ${result.adaptive.weightedCoverage}, critical coverage: ${result.adaptive.criticalCoverage}, rounds: ${result.adaptiveMeta?.rounds?.length || 0}, additional cost: $${result.cost.adaptiveAdditionalCostUsd}`
  );
  lines.push(`STOP: ${result.adaptiveMeta?.stopReason || "n/a"}`);
  lines.push("");
  lines.push("## CHARACTERS");
  lines.push(
    `Inferred MMC/FMC: ${result.characters.inferred.mmc || "—"} / ${result.characters.inferred.fmc || "—"}`
  );
    lines.push(
      `Expected: ${result.characters.expected.mmc || result.expectedCharacters?.mmc || "—"} / ${result.characters.expected.fmc || result.expectedCharacters?.fmc || "—"} (${result.characters.status})`
    );
  if (result.identityBefore || result.identityAfter) {
    const before = result.identityBefore || {};
    const after = result.identityAfter || {};
    lines.push(
      `Identity before: ${before.mmc || "—"} / ${before.fmc || "—"} (confidence ${before.confidence || "n/a"}, resolved ${before.resolved === true})`
    );
    lines.push(
      `Identity after: ${after.mmc || "—"} / ${after.fmc || "—"} (confidence ${after.confidence || "n/a"}, resolved ${after.resolved === true})`
    );
    lines.push(
      `Identity search: ${result.identityResolutionTriggered ? "yes" : "no"} · sources added: ${result.identitySourcesAdded} · changed: ${result.identityChanged} · cost: $${result.identityCostUsd}`
    );
  }
  lines.push("");
  lines.push("## FAILURE FLAGS");
  if (!result.flags.length) lines.push("- none automatically detected");
  else {
    for (const f of result.flags) {
      lines.push(
        `- ${f.code}${f.requiresHumanReview ? " (requiresHumanReview)" : ""}: ${f.detail}`
      );
    }
  }
  lines.push("");
  lines.push("## FIELDS");
  for (const field of result.fields) {
    lines.push("");
    lines.push(`### ${field.field}`);
    lines.push("");
    lines.push(
      `Score: ${field.score ?? "null"} · Coverage: ${field.initialCoverage} → ${field.finalCoverage} · Confidence: ${field.confidence || "n/a"} · Basis: ${field.basis || "n/a"}`
    );
    lines.push(
      `Precision: ${field.evidencePrecision ?? "[awaiting human labels]"} · Recall: ${field.referenceRecall ?? "[no reference evidence]"}`
    );
    const heur = field.heuristicEvidenceRelevance;
    if (heur) {
      lines.push(
        `Heuristic relevance (not ground truth): ${heur.fieldSpecificCount}/${heur.citedCount} field-specific · direct=${heur.byLevel?.direct || 0} supporting=${heur.byLevel?.supporting || 0} contextual=${heur.byLevel?.contextual || 0}`
      );
    }
    const initialIds = new Set(
      assessmentsOf(result.raw?.baselineAnalysis)?.[field.field]
        ?.evidenceSourceIds || []
    );
    const finalSources = resolveEvidenceSources(
      assessmentsOf(result.raw?.adaptiveAnalysis)[field.field],
      result.raw?.adaptiveResearch
    );
    const initialEvidence = finalSources.filter((s) => initialIds.has(s.id));
    const added = finalSources.filter((s) => !initialIds.has(s.id));
    lines.push("");
    lines.push("INITIAL EVIDENCE");
    if (!initialEvidence.length) lines.push("(none)");
    else initialEvidence.forEach((s, i) => lines.push(formatSourceLine(s, i)));
    const byRound = new Map();
    for (const s of added) {
      const r = s.adaptiveRound || (s.foundInRounds || [])[0] || 1;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r).push(s);
    }
    for (const [round, srcs] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push("");
      lines.push(`ADDED BY ROUND ${round}`);
      srcs.forEach((s, i) => lines.push(formatSourceLine(s, i)));
    }
    lines.push("");
    lines.push("FINAL EVIDENCE");
    if (!finalSources.length) lines.push("(none)");
    else finalSources.forEach((s, i) => lines.push(formatSourceLine(s, i)));
    lines.push("");
    lines.push(
      `Question: Are these sources actually sufficient to justify coverage ${field.finalCoverage}?`
    );
  }

  lines.push("");
  lines.push("## ADAPTIVE JOBS");
  for (const q of result.queries || []) {
    lines.push("");
    lines.push(`ROUND ${q.round}`);
    lines.push(`Strategy: ${(q.strategy || []).join(", ") || "n/a"}`);
    const job = (q.jobs || result.followUpJobs || []).find(
      (j) => j.round === q.round || q.strategy?.includes(j.strategy)
    ) || (result.followUpJobs || [])[0];
    if (job?.userPrompt) {
      lines.push("");
      lines.push("Prompt:");
      lines.push(job.userPrompt);
    }
    if (job?.queryHints?.length) {
      lines.push("");
      lines.push("Query hints:");
      for (const h of job.queryHints) lines.push(`- ${h}`);
    }
    lines.push("");
    lines.push(
      `Result: ${q.relevantSourcesAdded} relevant sources, coverage ${q.coverageGain >= 0 ? "gain " : ""}${q.coverageGain}`
    );
    if (q.evidenceOutcome || q.retrievalStatus) {
      lines.push(
        `Retrieval: ${q.retrievalStatus || "n/a"} · evidence: ${q.evidenceOutcome || "n/a"} · fallback ${q.fallbackTriggered ? (q.fallbackRecovered ? "recovered" : "triggered") : "no"}`
      );
    }
  }

  lines.push("");
  lines.push("## RETRIEVAL");
  const ret = result.retrieval || {};
  lines.push(
    `zeroRetrievalRate: ${ret.zeroRetrievalRate ?? "n/a"} · fallbackRate: ${ret.fallbackRate ?? "n/a"} · fallbackRecoveryRate: ${ret.fallbackRecoveryRate ?? "n/a"}`
  );
  lines.push(
    `evidencePerSearchCall: ${ret.evidencePerSearchCall ?? "n/a"} · directSupportingPerSearchCall: ${ret.directSupportingPerSearchCall ?? "n/a"} · costPerRelevantSource: ${ret.costPerRelevantSource ?? "n/a"}`
  );

  lines.push("");
  lines.push("## COST");
  lines.push(
    `initial $${result.cost.initialResearchCostUsd} · adaptive extra $${result.cost.adaptiveAdditionalCostUsd} (${result.cost.adaptiveSplit.note}) · total $${result.cost.totalCostUsd}`
  );
  if (result.cost.costPerUsefulAddedSource != null) {
    lines.push(`cost per useful added source: $${result.cost.costPerUsefulAddedSource}`);
  }
  if (result.cost.costPerTenCoverage != null) {
    lines.push(`cost per +10 coverage: $${result.cost.costPerTenCoverage}`);
  }
  return lines.join("\n");
}

export function evaluateSeriesBenchmark({
  id,
  category,
  identity,
  baselineResearch,
  baselineAnalysis,
  adaptiveResearch,
  adaptiveAnalysis,
  followUpJobs = [],
  groundTruth,
  mode = "offline",
} = {}) {
  const baseline = snapshotMetrics({
    research: baselineResearch,
    analysis: baselineAnalysis,
    identity,
  });
  const adaptive = snapshotMetrics({
    research: adaptiveResearch,
    analysis: adaptiveAnalysis,
    identity,
  });
  const gtSeries = groundTruth?.fields || {};
  const fields = SUBJECTIVE_KEYS.map((field) =>
    fieldBenchmark({
      field,
      initialResearch: baselineResearch,
      finalResearch: adaptiveResearch,
      initialAnalysis: baselineAnalysis,
      finalAnalysis: adaptiveAnalysis,
      groundField: gtSeries[field],
      identity,
    })
  );
  const adaptiveMeta = adaptiveResearch?.meta?.adaptive || {};
  const identityMeta = adaptiveMeta.identityResolution || {};
  const characters = validateCharacters({
    identity,
    research: adaptiveResearch || baselineResearch,
    expectedCharacters: groundTruth?.expectedCharacters,
    jobs: followUpJobs,
    identityAfter: identityMeta.after || null,
    identityBefore: identityMeta.before || null,
  });
  if (identityMeta.after) {
    characters.usedInQueries = identityMeta.after;
  }
  const queries = queryEffectiveness(adaptiveMeta.rounds || [], followUpJobs);
  const retrieval = summarizeRetrieval(adaptiveMeta);
  const cost = costReport({ baseline, adaptiveMeta });
  const comparison = compareBaselineAdaptive(baseline, adaptive);
  const wrongSubjectEvidence = collectWrongSubjectEvidence({
    research: adaptiveResearch,
    identity,
    leadCharacters:
      adaptiveResearch?.seriesIdentity || identityMeta.after || null,
  });
  const flags = detectFailureFlags({
    baseline,
    adaptive: { ...adaptive, research: adaptiveResearch, analysis: adaptiveAnalysis, metrics: adaptive, identity },
    fields,
    characters,
    adaptiveMeta,
    remainingGaps: adaptive.intelligence.gaps,
    wrongSubjectEvidence,
  });

  const result = {
    id,
    category,
    identity,
    mode,
    benchmarkVersion: BENCHMARK_VERSION,
    baseline: {
      sourceCount: baseline.sourceCount,
      relevantSourceCount: baseline.relevantSourceCount,
      weightedCoverage: baseline.weightedCoverage,
      criticalCoverage: baseline.criticalCoverage,
      costUsd: baseline.costUsd,
      typeDistribution: baseline.typeDistribution,
      independence: baseline.independence,
    },
    adaptive: {
      sourceCount: adaptive.sourceCount,
      relevantSourceCount: adaptive.relevantSourceCount,
      weightedCoverage: adaptive.weightedCoverage,
      criticalCoverage: adaptive.criticalCoverage,
      costUsd: adaptive.costUsd,
      rounds: adaptiveMeta.rounds?.length || 0,
      addedSources: comparison.sourceCountDelta,
      addedRelevantSources: comparison.relevantSourceCountDelta,
      stopReason: adaptiveMeta.stopReason || null,
      typeDistribution: adaptive.typeDistribution,
      independence: adaptive.independence,
    },
    comparison,
    fields,
    characters,
    queries,
    retrieval,
    followUpJobs,
    cost,
    flags,
    adaptiveMeta,
    remainingGaps: (adaptive.intelligence.gaps || []).map((g) => ({
      field: g.field,
      coverageScore: g.coverageScore,
      reasons: g.reasons,
      conflictLevel: g.conflictLevel,
    })),
    remainingCriticalGaps: adaptive.criticalFieldsBelowMinimum,
    remainingConflicts: (adaptive.intelligence.gaps || [])
      .filter((g) => g.conflictLevel === "meaningful")
      .map((g) => g.field),
    identityBefore: identityMeta.before || null,
    identityResolutionTriggered: Boolean(identityMeta.triggered),
    identitySourcesAdded: Number(identityMeta.sourcesAdded) || 0,
    identityAfter: identityMeta.after || null,
    expectedCharacters: groundTruth?.expectedCharacters || null,
    identityChanged: Boolean(identityMeta.changed),
    identityCostUsd: Number(identityMeta.costUsd) || 0,
    wrongSubjectEvidence,
    adaptiveEvidenceTrace: {
      identity: identityMeta.trace || null,
      rounds: (adaptiveMeta.rounds || []).map((r) => ({
        round: r.round,
        ...(r.evidenceTrace || {}),
      })),
    },
    raw: {
      baselineResearch,
      baselineAnalysis,
      adaptiveResearch,
      adaptiveAnalysis,
    },
  };
  result.reviewMarkdown = renderReviewMarkdown(result);
  return result;
}

export function findGroundTruth(groundTruthDoc, caseId, identity) {
  const list = groundTruthDoc?.series || [];
  return (
    list.find((s) => s.id === caseId) ||
    list.find(
      (s) =>
        (s.identity?.title || "").toLowerCase() ===
          (identity?.title || "").toLowerCase() &&
        (s.identity?.author || "").toLowerCase() ===
          (identity?.author || "").toLowerCase()
    ) ||
    null
  );
}

export function summarizeRun(results = []) {
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    seriesCount: results.length,
    flags: results.flatMap((r) =>
      (r.flags || []).map((f) => ({ series: r.id, ...f }))
    ),
    avgWeightedCoverageDelta: results.length
      ? Math.round(
          results.reduce(
            (acc, r) => acc + (r.comparison?.weightedCoverageDelta || 0),
            0
          ) / results.length
        )
      : 0,
    totalAdaptiveCostUsd: round4(
      results.reduce(
        (acc, r) => acc + (r.cost?.adaptiveAdditionalCostUsd || 0),
        0
      )
    ),
    retrieval: {
      zeroRetrievalRate: results.length
        ? round4(
            results.reduce((acc, r) => acc + (r.retrieval?.zeroRetrievalRate || 0), 0) /
              results.length
          )
        : null,
      fallbackRate: results.length
        ? round4(
            results.reduce((acc, r) => acc + (r.retrieval?.fallbackRate || 0), 0) /
              results.length
          )
        : null,
      fallbackRecoveryRate: results.length
        ? round4(
            results.reduce(
              (acc, r) => acc + (r.retrieval?.fallbackRecoveryRate || 0),
              0
            ) / results.length
          )
        : null,
      evidencePerSearchCall: results.length
        ? round4(
            results.reduce(
              (acc, r) => acc + (r.retrieval?.evidencePerSearchCall || 0),
              0
            ) / results.length
          )
        : null,
    },
  };
}

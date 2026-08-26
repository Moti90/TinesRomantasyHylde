/**
 * Adaptive research controller (Bid 2).
 * Executes Bid 1 follow-up plans via existing webResearch primitives.
 * Does not replace the 4-batch initial research.
 */

import { getOpenAIKey } from "./config.js";
import {
  analyzeResearchNeeds,
  buildIdentityResolutionJob,
  identitySnapshot,
  mergeAdaptiveSources,
  shouldTriggerIdentitySearch,
  softLeadCharacters,
  sourceIdentityKey,
  subjectiveSourceQuality,
} from "./adaptiveResearch.js";
import { attachSeriesRomanceIdentity } from "./seriesRomanceIdentity.js";
import {
  classifySourceRole,
  evaluateSourceForField,
  hasTargetFieldSignal,
  isFieldSpecificEvidence,
} from "./evidenceRelevance.js";
import { attachSubjectHintsToSource, subjectIdentityFrom } from "./sourceSubject.js";
import { runHandbookAnalysis } from "./handbookAnalysis.js";
import {
  ADAPTIVE_MAX_ADDITIONAL_COST_USD,
  ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS,
  ADAPTIVE_MAX_FOLLOWUP_ROUNDS,
  ADAPTIVE_MAX_IDENTITY_SEARCHES,
  ADAPTIVE_MAX_SOURCES_PER_JOB,
  ADAPTIVE_MIN_COVERAGE_GAIN,
  ADAPTIVE_TARGET_COVERAGE,
  ADAPTIVE_VERSION,
  ANALYSIS_MODEL,
  RESEARCH_MODEL,
  estimateCostUsd,
  isAdaptiveDebugEnabled,
  isAdaptiveResearchEnabled,
} from "./versions.js";
import {
  classifySourceType,
  normalizeResearch,
  runFocusedSearch,
  synthesizeResearch,
} from "./webResearch.js";
import {
  aggregateRoundSourceFlow,
  buildJobSourceFlow,
  classifyPrepareRejection,
  emptyPrepareDropReasons,
  formatSourceFlowLog,
  publicSourceFlow,
} from "./sourceFlow.js";
import {
  buildRoundFieldCoverageObservability,
  observePreparedSourceMix,
} from "./fieldCoverageObservability.js";
import { enrichJobsWithSourceMixOutcomes } from "./fieldResearchNeed.js";
import {
  assessRetrievalYield,
  buildFallbackQueryHints,
  buildFallbackUserPrompt,
  buildRetrievalApproaches,
  canAffordRetrievalFallback,
  classifyEvidenceOutcome,
  flattenRetrievalApproaches,
  mergeRetrievalAttempts,
  retrievalAttemptRecord,
  retrievalStatusAfterAttempts,
} from "./searchRetrieval.js";

export function shouldRunAdaptiveResearch({
  researchCacheHit = false,
  mode = "analyze",
  enabled = isAdaptiveResearchEnabled(),
} = {}) {
  if (!enabled) return false;
  if (mode === "reanalyze") return false;
  if (mode === "refresh") return true;
  if (mode === "analyze") return !researchCacheHit;
  return false;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function attachFieldCoverageObservability(roundRecord, {
  coverageBefore,
  coverageAfter,
  researchAfter,
  researchBefore,
  identity,
  assessments,
} = {}) {
  const obs = buildRoundFieldCoverageObservability({
    targetFields: roundRecord.targetFields,
    coverageBefore,
    coverageAfter: coverageAfter || coverageBefore,
    jobs: roundRecord.jobs,
    researchAfter,
    researchBefore,
    identity,
    assessments,
  });
  roundRecord.fieldSnapshotsBefore = obs.fieldSnapshotsBefore;
  roundRecord.fieldSnapshotsAfter = obs.fieldSnapshotsAfter;
  roundRecord.fieldCoverageSummary = obs.fieldCoverageSummary;
  roundRecord.fieldEligibleVsCounted = obs.fieldEligibleVsCounted;
  enrichJobsWithSourceMixOutcomes(roundRecord, { researchAfter });
  return roundRecord;
}

function formatFieldCoverageSummaryLog(summary) {
  if (!summary) return "";
  const lines = [
    `field coverage: ${summary.weightedCoverageBefore} → ${summary.weightedCoverageAfter} (Δ${summary.weightedDelta})`,
  ];
  for (const row of summary.fields || []) {
    lines.push(
      `${row.field}: coverage ${row.coverage} direct ${row.direct} supporting ${row.supporting} eligible ${row.eligibleThisRound} counted ${row.actuallyCountedThisRound} saturated=${row.supportingSaturated} stopQuality ${row.stopQuality}`
    );
  }
  return lines.join("\n");
}

function combineJobRetrievalStatus(statuses = []) {
  const list = (statuses || []).filter(Boolean);
  if (!list.length) return null;
  if (list.every((s) => s === "retrieval_zero")) return "retrieval_zero";
  if (list.includes("fallback_recovered")) return "fallback_recovered";
  if (list.includes("fallback_low") && !list.includes("primary_usable")) {
    return "fallback_low";
  }
  if (list.includes("budget_blocked_fallback")) return "budget_blocked_fallback";
  if (list.includes("primary_usable")) return "primary_usable";
  return list[0];
}

function roundRetrievalDiagnostics(jobTrace = [], { addedCount, relevantCount, draftCount } = {}) {
  const rawUrlCount = jobTrace.reduce(
    (n, j) => n + (Number(j.rawUrlCount) || 0),
    0
  );
  const mergedCount = jobTrace.reduce(
    (n, j) => n + (Number(j.mergedCount) || 0),
    0
  );
  const retrievalStatus = combineJobRetrievalStatus(
    jobTrace.map((j) => j.retrievalStatus)
  );
  return {
    retrievalStatus,
    evidenceOutcome: classifyEvidenceOutcome({
      retrievalStatus,
      addedCount,
      relevantCount,
      rawUrlCount,
      mergedCount: mergedCount || draftCount || 0,
    }),
    fallbackTriggered: jobTrace.some((j) => j.fallbackTriggered),
    fallbackRecovered: retrievalStatus === "fallback_recovered",
  };
}

function assessmentsOf(analysis) {
  return analysis?.meta?.assessments || analysis?.assessments || {};
}

function meaningfulConflictCount(intelligence) {
  return (intelligence?.gaps || []).filter(
    (g) => g.conflictLevel === "meaningful"
  ).length;
}

function isGenericSummary(source) {
  return /^Fundet via /i.test(String(source?.summary || "").trim());
}

function asRawFinding(u, batchHint) {
  const raw = typeof u === "string" ? { url: u } : { ...(u || {}) };
  if (!String(raw.summary || "").trim()) {
    raw.summary = `Fundet via ${batchHint || "søgning"}-søgning`;
  }
  return raw;
}

export function isFollowUpSourceRelevant(source, jobs = [], context = {}) {
  if (!source) return false;
  if (source.nearDuplicate) return false;
  if (isGenericSummary(source)) return false;
  const type = String(source.type || "").toLowerCase();
  if (["catalog", "official", "publisher"].includes(type)) return false;
  const targetFields = [
    ...(source.targetFields || []),
    ...jobs.flatMap((j) => j.targetFields || j.fields || []),
  ];
  const uniqueFields = [...new Set(targetFields.filter(Boolean))];
  if (!uniqueFields.length) return false;
  const src = source.id ? source : { ...source, id: "tmp-1" };
  const evalContext = {
    ...subjectIdentityFrom(context.research || {}, context.identity || {}, {
      leadCharacters: context.leadCharacters || jobs[0]?.leadCharacters,
    }),
    leadCharacters: context.leadCharacters || jobs[0]?.leadCharacters,
    identity: context.identity,
    research: context.research,
  };
  const contentHit = hasTargetFieldSignal(src, uniqueFields, evalContext);
  if (!contentHit) return false;
  const quality = subjectiveSourceQuality(source);
  if (quality >= 0.5) return true;
  const role = classifySourceRole(source);
  if (role === "bibliographic") return false;
  return role === "study_guide" || role === "other" || type === "other" || type === "wikipedia";
}

export function debugSourceEvidenceTrace(source, jobs = [], context = {}) {
  const targetFields = [
    ...(source?.targetFields || []),
    ...jobs.flatMap((j) => j.targetFields || j.fields || []),
  ];
  const uniqueFields = [...new Set(targetFields.filter(Boolean))];
  const src = source?.id ? source : { ...(source || {}), id: "tmp-1" };
  const quality = source ? subjectiveSourceQuality(source) : 0;
  const evalContext = {
    ...subjectIdentityFrom(context.research || {}, context.identity || {}, {
      leadCharacters: context.leadCharacters || jobs[0]?.leadCharacters,
    }),
    leadCharacters: context.leadCharacters || jobs[0]?.leadCharacters,
    identity: context.identity,
    research: context.research,
  };
  const fields = {};
  for (const field of uniqueFields) {
    const ev = evaluateSourceForField({ source: src, field, context: evalContext });
    const raw = ev.rawRelevance || ev.relevance;
    const validated = ev.validatedRelevance || ev.relevance;
    fields[field] = {
      relevance: ev.relevance,
      rawRelevance: raw,
      validatedRelevance: validated,
      matchedDirectPatterns: ev.matchedDirectPatterns || ev.matchedPhenomena || [],
      matchedSupportingPatterns: ev.matchedSupportingPatterns || [],
      matchedNegativePatterns: ev.matchedNegativePatterns || [],
      sourceRole: ev.sourceRole,
      subject: ev.subject
        ? {
            status: ev.subject.subjectStatus,
            targetMmc: ev.subject.targetMmc,
            detected: (ev.subject.alternativeMentions || [])
              .map((a) => a.name)
              .concat(ev.subject.targetMmcMentioned ? [ev.subject.targetMmc] : [])
              .filter(Boolean),
          }
        : null,
      reason: ev.subjectRejectionReason || ev.subjectReason || null,
      rejectedBecause: isFieldSpecificEvidence(ev) ? null : ev.reason,
    };
  }
  const countsAsNewRelevant = isFollowUpSourceRelevant(source, jobs, context);
  return {
    id: source?.id || null,
    url: source?.url || null,
    title: source?.title || null,
    purpose: source?.purpose || "field",
    quality,
    genericSummary: isGenericSummary(source),
    select: {
      kept: true,
      reason: "adaptive_follow_up_merge",
    },
    targetFields: uniqueFields,
    fields,
    countsAsNewRelevant,
    contentOverride: countsAsNewRelevant && quality < 0.5,
  };
}

function summarizeEvidenceTrace(traces = []) {
  const counts = { direct: 0, supporting: 0, contextual: 0, none: 0 };
  let droppedBeforeRelevance = 0;
  for (const t of traces) {
    if (t.select?.kept === false) {
      droppedBeforeRelevance += 1;
      continue;
    }
    const levels = Object.values(t.fields || {}).map((f) => f.relevance);
    if (levels.includes("direct")) counts.direct += 1;
    else if (levels.includes("supporting")) counts.supporting += 1;
    else if (levels.includes("contextual")) counts.contextual += 1;
    else counts.none += 1;
  }
  return {
    targetSourceCandidates: traces.length,
    droppedBeforeRelevance,
    directCount: counts.direct,
    supportingCount: counts.supporting,
    contextualCount: counts.contextual,
    noneCount: counts.none,
    relevantIds: traces.filter((t) => t.countsAsNewRelevant).map((t) => t.id || t.url),
  };
}

export function prepareFollowUpSourcesDiagnostic(findings, job, round) {
  const targetFields = job?.targetFields || job?.fields || [];
  const cap = Math.max(1, Number(ADAPTIVE_MAX_SOURCES_PER_JOB) || 8);
  const out = [];
  const seen = new Set();
  const dropReasons = emptyPrepareDropReasons();
  const list = findings || [];

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (out.length >= cap) {
      dropReasons.cap += list.length - i;
      break;
    }
    const reason = classifyPrepareRejection(f, { seen, skipCatalogPr: false });
    if (reason) {
      dropReasons[reason] = (dropReasons[reason] || 0) + 1;
      continue;
    }
    const type = classifySourceType(f.url, f.title, f.type);
    const key = sourceIdentityKey({ url: f.url, id: f.title });
    if (key) seen.add(key);
    const row = {
      title: f.title || "Kilde",
      url: f.url || null,
      type,
      batch: f.batch || job?.batchHint || null,
      summary: String(f.summary || "").slice(0, 500),
      focus: f.focus || job?.batchHint || job?.strategy,
      adaptiveRound: round,
      followUpJobId: job?.id || null,
      targetFields,
      strategy: job?.strategy || null,
      adaptiveStrategies: job?.strategy ? [job.strategy] : [],
      foundInRounds: [round],
      retrievalAttempt: f.retrievalAttempt || null,
      retrievalStrategy: f.retrievalStrategy || null,
    };
    out.push(attachSubjectHintsToSource(row, job?.leadCharacters || {}));
  }
  return { sources: out, dropReasons };
}

export function prepareFollowUpSources(findings, job, round) {
  return prepareFollowUpSourcesDiagnostic(findings, job, round).sources;
}

async function createOpenAIClient(apiKey) {
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey });
}

export function prepareIdentitySourcesDiagnostic(findings, job) {
  const cap = Math.max(1, Number(ADAPTIVE_MAX_SOURCES_PER_JOB) || 8);
  const out = [];
  const seen = new Set();
  const dropReasons = emptyPrepareDropReasons();
  const list = findings || [];

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (out.length >= cap) {
      dropReasons.cap += list.length - i;
      break;
    }
    const reason = classifyPrepareRejection(f, { seen, skipCatalogPr: true });
    if (reason) {
      dropReasons[reason] = (dropReasons[reason] || 0) + 1;
      continue;
    }
    const type = classifySourceType(f.url, f.title, f.type);
    const key = sourceIdentityKey({ url: f.url, id: f.title });
    if (key) seen.add(key);
    out.push({
      title: f.title || "Kilde",
      url: f.url || null,
      type,
      batch: "series_identity",
      summary: String(f.summary || "").slice(0, 800),
      focus: "series_identity",
      purpose: "identity",
      adaptiveRound: 0,
      followUpJobId: job?.id || "identity-resolution-r0-1",
      targetFields: [],
      strategy: "series_identity_resolution",
      adaptiveStrategies: ["series_identity_resolution"],
      foundInRounds: [0],
      retrievalAttempt: f.retrievalAttempt || null,
      retrievalStrategy: f.retrievalStrategy || null,
    });
  }
  return { sources: out, dropReasons };
}

export function prepareIdentitySources(findings, job) {
  return prepareIdentitySourcesDiagnostic(findings, job).sources;
}

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

function searchCostUsd(result) {
  if (result?.searchCostUsd != null) return Number(result.searchCostUsd) || 0;
  const retryIn = Number(result?.retryInputTokens) || 0;
  const retryOut = Number(result?.retryOutputTokens) || 0;
  const input = Math.max(0, (Number(result?.inputTokens) || 0) - retryIn);
  const output = Math.max(0, (Number(result?.outputTokens) || 0) - retryOut);
  const computed = estimateCostUsd(ANALYSIS_MODEL, input, output);
  if (computed > 0) return computed;
  if (result?.costUsd != null) return Number(result.costUsd) || 0;
  return 0;
}

function repairCostUsd(result) {
  if (result?.retryCostUsd != null) return Number(result.retryCostUsd) || 0;
  return estimateCostUsd(
    ANALYSIS_MODEL,
    result?.retryInputTokens || 0,
    result?.retryOutputTokens || 0
  );
}

function prepareJobSourcesDiagnostic(findings, job, round) {
  const isIdentity =
    job?.strategy === "series_identity_resolution" || job?.purpose === "identity";
  return isIdentity
    ? prepareIdentitySourcesDiagnostic(findings, job)
    : prepareFollowUpSourcesDiagnostic(findings, job, round);
}

function prepareJobSources(findings, job, round) {
  return prepareJobSourcesDiagnostic(findings, job, round).sources;
}

/**
 * One focused Responses/web_search, plus at most one broadened fallback
 * when retrieval yield is zero/low. Parse repair is inside runFocusedSearch
 * and does not count as a retrieval attempt.
 */
export async function executeFocusedJobWithFallback({
  job,
  identity,
  round = 1,
  remainingSearchCalls = Infinity,
  remainingCostUsd = Infinity,
  runSearch = runFocusedSearch,
  client,
  research = null,
  existingSources = null,
} = {}) {
  const isIdentity =
    job?.strategy === "series_identity_resolution" || job?.purpose === "identity";
  const approaches =
    job?.retrievalApproaches ||
    buildRetrievalApproaches({
      identity,
      series: job?.series || {},
      leadCharacters: job?.leadCharacters || {},
      targetFields: job?.targetFields || job?.fields || [],
      strategy: job?.strategy || "",
      purpose: isIdentity ? "identity" : job?.purpose || "field",
      retrievalMode: isIdentity ? "general" : job?.retrievalMode || "general",
    });
  const focus = isIdentity ? "series_identity" : job?.batchHint || "helteprofil";
  const batch = focus;
  const purpose = isIdentity ? "identity" : "field";
  const leads = job?.leadCharacters || research?.seriesIdentity || {};
  const existing = existingSources || research?.sources || [];
  const evalContext = {
    research: research || {},
    identity,
    leadCharacters: leads,
    ...subjectIdentityFrom(research || {}, identity || {}, {
      leadCharacters: leads,
    }),
  };

  const runOnce = (overrides = {}) =>
    runSearch(client, {
      id: overrides.id || job?.id,
      focus,
      query: "",
      userPrompt: overrides.userPrompt,
      batch,
      queryHints: overrides.queryHints ?? job?.queryHints ?? [],
      maxFindings: ADAPTIVE_MAX_SOURCES_PER_JOB,
      purpose,
    });

  const primary = await runOnce({
    id: job?.id,
    userPrompt: job?.userPrompt || "",
    queryHints:
      job?.queryHints ||
      flattenRetrievalApproaches(approaches, job?.retrievalMode || approaches.retrievalMode),
  });
  const primaryPreparedDiag = prepareJobSourcesDiagnostic(
    primary.findings,
    job,
    round
  );
  const primaryPrepared = primaryPreparedDiag.sources;
  const primaryYield = assessRetrievalYield({
    rawUrlCount: primary.rawUrlCount ?? (primary.rawUrls || []).length,
    mergedCount: (primary.findings || []).length,
    preparedCount: primaryPrepared.length,
    parseStatus: primary.parseStatus,
  });
  const primaryCost = searchCostUsd(primary);
  const primaryRepair = repairCostUsd(primary);
  const attempts = [
    retrievalAttemptRecord({
      attempt: 1,
      strategy: "primary",
      result: primary,
      preparedCount: primaryPrepared.length,
      yieldLevel: primaryYield.level,
    }),
  ];

  let fallbackTriggered = false;
  let fallbackBlockedByBudget = false;
  let combined = primary;
  let preparedDiag = primaryPreparedDiag;
  let fallbackCost = 0;
  let fallbackRepair = 0;
  let finalYield = primaryYield;

  const affordFallback = canAffordRetrievalFallback({
    remainingSearchCalls,
    primaryWebSearchCalls: primary.webSearchCalls || 0,
  });
  const remainingCostAfterPrimary =
    remainingCostUsd == null || !Number.isFinite(Number(remainingCostUsd))
      ? Infinity
      : Number(remainingCostUsd) - primaryCost - primaryRepair;

  if (primaryYield.shouldFallback) {
    if (!affordFallback || remainingCostAfterPrimary <= 0) {
      fallbackBlockedByBudget = true;
    } else {
      fallbackTriggered = true;
      const fallbackPrompt = buildFallbackUserPrompt({
        identity,
        series: job?.series || {},
        leadCharacters: job?.leadCharacters || {},
        strategy: job?.strategy || "",
        targetFields: job?.targetFields || job?.fields || [],
        purpose,
      });
      const fallback = await runOnce({
        id: `${job?.id || "job"}-fallback`,
        userPrompt: fallbackPrompt,
        queryHints: buildFallbackQueryHints(approaches),
      });
      fallbackCost = searchCostUsd(fallback);
      fallbackRepair = repairCostUsd(fallback);
      combined = mergeRetrievalAttempts(primary, fallback);
      preparedDiag = prepareJobSourcesDiagnostic(combined.findings, job, round);
      finalYield = assessRetrievalYield({
        rawUrlCount: combined.rawUrlCount ?? (combined.rawUrls || []).length,
        mergedCount: (combined.findings || []).length,
        preparedCount: preparedDiag.sources.length,
        parseStatus: combined.parseStatus,
      });
      attempts.push(
        retrievalAttemptRecord({
          attempt: 2,
          strategy: "broad_fallback",
          result: fallback,
          preparedCount: prepareJobSources(fallback.findings, job, round).length,
          yieldLevel: assessRetrievalYield({
            rawUrlCount: fallback.rawUrlCount ?? (fallback.rawUrls || []).length,
            mergedCount: (fallback.findings || []).length,
            preparedCount: prepareJobSources(fallback.findings, job, round).length,
            parseStatus: fallback.parseStatus,
          }).level,
        })
      );
    }
  }

  const retrievalStatus = retrievalStatusAfterAttempts({
    fallbackTriggered,
    fallbackBlockedByBudget,
    finalYield,
  });
  const retryCost = round6(primaryRepair + fallbackRepair);
  const totalSearchCost = round6(primaryCost + fallbackCost);
  const prepared = preparedDiag.sources;
  const sourceFlow = buildJobSourceFlow({
    rawUrls: combined.rawUrls || [],
    modelFindingCount: Number(combined.modelFindingCount) || 0,
    mergedDraftsBeforeCap:
      combined.mergedDraftsBeforeCap || combined.findings || [],
    returnedFindings: combined.findings || [],
    prepared,
    cappedDrafts: combined.cappedDrafts || [],
    droppedFocus: combined.droppedFocus || [],
    prepareDropReasons: preparedDiag.dropReasons,
    existingSources: existing,
    targetFields: job?.targetFields || job?.fields || [],
    context: evalContext,
    includeSourceDetails: isAdaptiveDebugEnabled(),
  });

  return {
    sources: prepared,
    pairing: combined.pairing || null,
    parseStatus: combined.parseStatus || null,
    retryUsed: Boolean(combined.retryUsed),
    rawUrls: combined.rawUrls || [],
    findings: combined.findings || [],
    webSearchCalls: combined.webSearchCalls || 0,
    inputTokens: combined.inputTokens || 0,
    outputTokens: combined.outputTokens || 0,
    retryInputTokens: combined.retryInputTokens || 0,
    retryOutputTokens: combined.retryOutputTokens || 0,
    retryCostUsd: retryCost,
    primarySearchCostUsd: round6(primaryCost),
    fallbackSearchCostUsd: round6(fallbackCost),
    totalSearchCostUsd: totalSearchCost,
    costUsd: round6(totalSearchCost + retryCost),
    retrievalAttempts: attempts,
    retrievalStatus,
    fallbackTriggered,
    fallbackBlockedByBudget,
    retrievalYield: finalYield.level,
    sourceFlow,
  };
}

export async function defaultExecuteFollowUpJob(opts = {}) {
  const key = getOpenAIKey();
  if (!key) throw new Error("missing_api_key");
  const client = await createOpenAIClient(key);
  return executeFocusedJobWithFallback({
    ...opts,
    client,
    runSearch: runFocusedSearch,
  });
}

export async function rebuildResearchFromSources({
  identity,
  catalog,
  mofibo,
  sources,
  previousResearch,
  searchResults = [],
  synthesize,
}) {
  const synthFn = synthesize;
  if (!synthFn) throw new Error("synthesize missing");
  const synth = await synthFn({
    identity,
    catalog,
    mofibo,
    sources,
    searchResults,
  });
  const parsed = synth.parsed || synth;
  const inputTokens = synth.inputTokens || 0;
  const outputTokens = synth.outputTokens || 0;
  const costUsd =
    synth.costUsd ??
    estimateCostUsd(RESEARCH_MODEL, inputTokens, outputTokens);

  const previousMeta = previousResearch?.meta || {};
  const research = normalizeResearch(parsed, identity, {
    promptVersion: previousMeta.promptVersion,
    model: synth.model || previousMeta.model,
    webSearchCalls: previousMeta.webSearchCalls || 0,
    inputTokens: (previousMeta.inputTokens || 0) + inputTokens,
    outputTokens: (previousMeta.outputTokens || 0) + outputTokens,
    estimatedCostUsd: (previousMeta.estimatedCostUsd || 0) + costUsd,
    partial: previousMeta.partial,
    warnings: previousMeta.warnings || [],
    searchPlan: previousMeta.searchPlan,
    lockedSources: sources,
  });

  if (!research.ratings?.goodreads && previousResearch?.ratings?.goodreads) {
    research.ratings.goodreads = previousResearch.ratings.goodreads;
  }
  if (previousResearch?.facts) {
    for (const [key, fact] of Object.entries(previousResearch.facts)) {
      const next = research.facts?.[key];
      if (
        fact?.status === "verified" &&
        (!next || next.status === "not_verified" || next.value == null)
      ) {
        research.facts[key] = fact;
      }
    }
  }
  if (previousResearch?.identityHint) {
    research.identityHint = previousResearch.identityHint;
  }
  if (previousResearch?.seriesIdentity) {
    research.seriesIdentity = previousResearch.seriesIdentity;
  }
  if (previousResearch?.seriesRomanceIdentity) {
    research.seriesRomanceIdentity = previousResearch.seriesRomanceIdentity;
  }
  return { research, inputTokens, outputTokens, costUsd };
}

async function defaultSynthesize(args) {
  const key = getOpenAIKey();
  if (!key) throw new Error("missing_api_key");
  const client = await createOpenAIClient(key);
  return synthesizeResearch(client, args);
}

async function defaultAnalyze({ research, catalog, mofibo, identity }) {
  return runHandbookAnalysis({
    research,
    catalog,
    mofibo,
    query: [identity?.title, identity?.author].filter(Boolean).join(" ") ||
      identity?.title ||
      "",
    force: true,
    updateGoodreads: false,
  });
}

function adaptiveLog(...args) {
  if (process.env.NODE_ENV === "production") return;
  console.log("[adaptive]", ...args);
}

function stopFromIntelligence(intelligence) {
  const coverage = intelligence?.coverage || {};
  const meaningful = meaningfulConflictCount(intelligence);
  const missingQuality = coverage.criticalFieldsMissingStopQuality || [];
  if (!(intelligence?.followUpPlan || []).length) {
    if (
      (coverage.weightedCoverage || 0) >= ADAPTIVE_TARGET_COVERAGE &&
      !(coverage.criticalFieldsBelowMinimum || []).length &&
      missingQuality.length === 0 &&
      meaningful === 0
    ) {
      return "target_reached";
    }
    return "no_gaps";
  }
  return null;
}

function attachAdaptiveMeta(research, adaptive) {
  const next = research || {};
  next.meta = {
    ...(next.meta || {}),
    webSearchCalls: adaptive.totalWebSearchCalls,
    inputTokens: adaptive.totalInputTokens,
    outputTokens: adaptive.totalOutputTokens,
    estimatedCostUsd: adaptive.totalResearchCostUsd,
    warnings: [
      ...new Set([
        ...((next.meta && next.meta.warnings) || []),
        ...(adaptive.warnings || []),
      ]),
    ],
    adaptive,
  };
  return next;
}

/**
 * Adaptive follow-up loop. Never re-runs the initial 4-batch research.
 */
export async function runAdaptiveResearch({
  identity,
  initialResearch,
  initialAnalysis,
  catalog,
  mofibo,
  options = {},
} = {}) {
  const enabled =
    options.enabled ?? isAdaptiveResearchEnabled();
  const initialCost = Number(initialResearch?.meta?.estimatedCostUsd) || 0;
  const initialSearch = Number(initialResearch?.meta?.webSearchCalls) || 0;
  const initialIn = Number(initialResearch?.meta?.inputTokens) || 0;
  const initialOut = Number(initialResearch?.meta?.outputTokens) || 0;

  const emptyAdaptive = (stopReason, extra = {}) => {
    const researchForMeta = extra.research || initialResearch || {};
    const adaptive = {
      version: ADAPTIVE_VERSION,
      enabled,
      initialCoverage: extra.initialCoverage ?? null,
      finalCoverage: extra.finalCoverage ?? extra.initialCoverage ?? null,
      targetCoverage: ADAPTIVE_TARGET_COVERAGE,
      initialResearchCostUsd: initialCost,
      additionalCostUsd: 0,
      totalResearchCostUsd: initialCost,
      additionalWebSearchCalls: 0,
      totalAdditionalWebSearchCalls: 0,
      totalWebSearchCalls: extra.totalWebSearchCalls ?? initialSearch,
      totalInputTokens: initialIn,
      totalOutputTokens: initialOut,
      rounds: [],
      stopReason,
      warnings: extra.warnings || [],
      identityResolution: extra.identityResolution || null,
      ...extra,
    };
    delete adaptive.research;
    return {
      research: attachAdaptiveMeta(cloneJson(researchForMeta), adaptive),
      analysis: extra.analysis || initialAnalysis,
      adaptive,
    };
  };

  if (!enabled) {
    return emptyAdaptive("disabled");
  }

  let research = cloneJson(initialResearch || { sources: [], meta: {} });
  let analysis = initialAnalysis;
  const deps = {
    executeFollowUpJob:
      options.executeFollowUpJob || defaultExecuteFollowUpJob,
    synthesize: options.synthesize || defaultSynthesize,
    analyze: options.analyze || defaultAnalyze,
  };

  const maxRounds =
    options.maxFollowUpRounds ?? ADAPTIVE_MAX_FOLLOWUP_ROUNDS;
  const maxSearch =
    options.maxAdditionalWebSearchCalls ??
    ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS;
  const maxCost =
    options.maxAdditionalCostUsd ?? ADAPTIVE_MAX_ADDITIONAL_COST_USD;
  const minGain = options.minCoverageGain ?? ADAPTIVE_MIN_COVERAGE_GAIN;
  const maxIdentitySearches =
    options.maxIdentitySearches ?? ADAPTIVE_MAX_IDENTITY_SEARCHES;

  const warnings = [];
  let additionalCost = 0;
  let additionalSearch = 0;
  let additionalIn = 0;
  let additionalOut = 0;

  const identityBeforeLeads = softLeadCharacters(research, identity);
  const identityResolution = {
    triggered: false,
    searchCalls: 0,
    sourcesAdded: 0,
    costUsd: 0,
    totalCostUsd: 0,
    retryCostUsd: 0,
    parseStatus: null,
    retryUsed: false,
    rawUrlCount: 0,
    before: identitySnapshot(identityBeforeLeads),
    after: identitySnapshot(identityBeforeLeads),
    changed: false,
  };

  adaptiveLog(
    `Series identity:\nMMC: ${identityResolution.before.mmc || "—"}\nFMC: ${identityResolution.before.fmc || "—"}\nconfidence: ${identityResolution.before.confidence}\nresolved: ${identityResolution.before.resolved}\nreason: ${identityResolution.before.reason || "n/a"}`
  );

  const canAffordIdentity =
    additionalSearch < maxSearch && additionalCost < maxCost;
  if (
    shouldTriggerIdentitySearch(identityBeforeLeads, identity) &&
    maxIdentitySearches > 0 &&
    canAffordIdentity
  ) {
    adaptiveLog("Identity resolution search...");
    const job = buildIdentityResolutionJob({
      identity,
      leadCharacters: identityBeforeLeads,
    });
    try {
      const result = await deps.executeFollowUpJob({
        job,
        identity,
        research,
        catalog,
        mofibo,
        round: 0,
        remainingSearchCalls: maxSearch - additionalSearch,
        remainingCostUsd: maxCost - additionalCost,
      });
      const calls = Number(result?.webSearchCalls) || 0;
      const cost = Number(result?.costUsd) || 0;
      const retryCost =
        result?.retryCostUsd != null
          ? Number(result.retryCostUsd)
          : estimateCostUsd(
              ANALYSIS_MODEL,
              result?.retryInputTokens || 0,
              result?.retryOutputTokens || 0
            );
      additionalSearch += calls;
      additionalCost += cost;
      additionalIn += Number(result?.inputTokens) || 0;
      additionalOut += Number(result?.outputTokens) || 0;
      let drafts = (result?.sources || []).map((s) => ({
        ...s,
        purpose: "identity",
        targetFields: [],
        strategy: "series_identity_resolution",
      }));
      if (!drafts.length && (result?.rawUrls || []).length) {
        // Defensive: mocked executeFollowUpJob and focusAllowsSource-empty
        // findings can still carry raw URLs. runFocusedSearch already merges
        // raw URLs into findings, so this is a no-op on the normal path.
        drafts = prepareIdentitySources(
          (result.rawUrls || []).map((u) => asRawFinding(u, "series_identity")),
          job
        ).map((s) => ({
          ...s,
          purpose: "identity",
          targetFields: [],
          strategy: "series_identity_resolution",
        }));
      }
      const merge = mergeAdaptiveSources(research.sources || [], drafts);
      research = {
        ...research,
        sources: merge.sources,
        identityHint: result?.pairing || research.identityHint || null,
      };
      identityResolution.triggered = true;
      identityResolution.searchCalls = calls;
      identityResolution.sourcesAdded = (merge.added || []).length;
      identityResolution.costUsd = Math.round(cost * 10000) / 10000;
      identityResolution.totalCostUsd = identityResolution.costUsd;
      identityResolution.retryCostUsd = Math.round(retryCost * 1e6) / 1e6;
      identityResolution.parseStatus = result?.parseStatus || null;
      identityResolution.retryUsed = Boolean(result?.retryUsed);
      identityResolution.rawUrlCount = (result?.rawUrls || []).length;
      identityResolution.retrievalAttempts = result?.retrievalAttempts || [];
      identityResolution.retrievalStatus = result?.retrievalStatus || null;
      identityResolution.fallbackTriggered = Boolean(result?.fallbackTriggered);
      identityResolution.primarySearchCostUsd =
        result?.primarySearchCostUsd ?? null;
      identityResolution.fallbackSearchCostUsd =
        result?.fallbackSearchCostUsd ?? 0;
      identityResolution.totalSearchCostUsd =
        result?.totalSearchCostUsd ?? identityResolution.costUsd;
      identityResolution.sourceFlow = result?.sourceFlow
        ? publicSourceFlow(result.sourceFlow)
        : null;
      identityResolution.jobs = [
        {
          jobId: job.id,
          parseStatus: result?.parseStatus || null,
          retryUsed: Boolean(result?.retryUsed),
          retrievalAttempts: result?.retrievalAttempts || [],
          retrievalStatus: result?.retrievalStatus || null,
        },
      ];
    } catch (err) {
      identityResolution.triggered = true;
      identityResolution.parseStatus = "failed";
      warnings.push(
        `identity resolution failed: ${err?.message || err}`
      );
      adaptiveLog(`identity search failed: ${err?.message || err}`);
    }
  } else if (identityResolution.before.resolved) {
    adaptiveLog(
      "Series identity resolved from initial research — no identity search"
    );
  }

  const identityAfterLeads = softLeadCharacters(research, identity);
  identityResolution.after = identitySnapshot(identityAfterLeads);
  identityResolution.trace = identityAfterLeads?.resolution?.trace || null;
  identityResolution.changed =
    identityResolution.before.mmc !== identityResolution.after.mmc ||
    identityResolution.before.fmc !== identityResolution.after.fmc;
  research.seriesIdentity = identityAfterLeads;
  attachSeriesRomanceIdentity(research, identityAfterLeads);

  if (identityResolution.triggered) {
    adaptiveLog(
      `Series identity after resolution:\nMMC: ${identityResolution.after.mmc || "—"}\nFMC: ${identityResolution.after.fmc || "—"}\nconfidence: ${identityResolution.after.confidence}\nresolved: ${identityResolution.after.resolved}\nreason: ${identityResolution.after.reason || "n/a"}`
    );
  }

  let intelligence = analyzeResearchNeeds({
    identity,
    research,
    assessments: assessmentsOf(analysis),
  });
  const initialCoverage = intelligence.coverage.weightedCoverage;
  adaptiveLog(`Adaptive research\nInitial coverage: ${initialCoverage}`);

  const early = stopFromIntelligence(intelligence);
  if (early) {
    adaptiveLog(`STOP: ${early}`);
    return emptyAdaptive(early, {
      initialCoverage,
      finalCoverage: initialCoverage,
      additionalCostUsd: Math.round(additionalCost * 10000) / 10000,
      totalResearchCostUsd:
        Math.round((initialCost + additionalCost) * 10000) / 10000,
      additionalWebSearchCalls: additionalSearch,
      totalAdditionalWebSearchCalls: additionalSearch,
      totalWebSearchCalls: initialSearch + additionalSearch,
      totalInputTokens: initialIn + additionalIn,
      totalOutputTokens: initialOut + additionalOut,
      warnings,
      identityResolution,
      research,
      analysis,
    });
  }

  const rounds = [];
  let stopReason = "max_rounds";
  let plannerCalls = 1;

  try {
    for (let round = 1; round <= maxRounds; round++) {
      const planStop = stopFromIntelligence(intelligence);
      if (planStop) {
        stopReason = planStop;
        break;
      }

      if (additionalSearch >= maxSearch) {
        stopReason = "search_budget_reached";
        break;
      }
      if (additionalCost >= maxCost) {
        stopReason = "cost_budget_reached";
        break;
      }

      const jobs = intelligence.followUpPlan || [];
      const coverageBeforeIntel = intelligence.coverage;
      const coverageBefore = coverageBeforeIntel.weightedCoverage;
      const researchBeforeRound = { sources: research.sources || [] };
      const roundAssessments = assessmentsOf(analysis);
      const criticalBefore = [
        ...(intelligence.coverage.criticalFieldsBelowMinimum || []),
      ];
      const conflictsBefore = meaningfulConflictCount(intelligence);

      adaptiveLog(
        `Round ${round}\ntargets:\n${jobs
          .flatMap((j) => j.targetFields || j.fields || [])
          .map((f) => `- ${f}`)
          .join("\n")}\njobs: ${jobs.length}`
      );

      const roundDrafts = [];
      const jobTrace = [];
      let roundSearch = 0;
      let roundCost = 0;
      let roundIn = 0;
      let roundOut = 0;
      let succeeded = 0;

      for (const job of jobs) {
        if (additionalSearch + roundSearch >= maxSearch) break;
        try {
          const result = await deps.executeFollowUpJob({
            job,
            identity,
            research,
            catalog,
            mofibo,
            round,
            remainingSearchCalls: maxSearch - additionalSearch - roundSearch,
            remainingCostUsd: maxCost - additionalCost - roundCost,
          });
          const calls = Number(result?.webSearchCalls) || 0;
          const cost = Number(result?.costUsd) || 0;
          roundSearch += calls;
          roundCost += cost;
          roundIn += Number(result?.inputTokens) || 0;
          roundOut += Number(result?.outputTokens) || 0;
          roundDrafts.push(...(result?.sources || []));
          if (!(result?.sources || []).length && (result?.rawUrls || []).length) {
            // Same defensive backfill as identity: custom/mocked jobs may
            // return rawUrls without prepared sources.
            roundDrafts.push(
              ...prepareFollowUpSources(
                (result.rawUrls || []).map((u) =>
                  asRawFinding(u, job.batchHint || "helteprofil")
                ),
                job,
                round
              )
            );
          }
          succeeded += 1;
          const sourceFlow =
            result?.sourceFlow ||
            buildJobSourceFlow({
              rawUrls: result?.rawUrls || [],
              modelFindingCount: Number(result?.modelFindingCount) || 0,
              mergedDraftsBeforeCap:
                result?.mergedDraftsBeforeCap || result?.findings || [],
              returnedFindings: result?.findings || result?.sources || [],
              prepared: result?.sources || [],
              cappedDrafts: result?.cappedDrafts || [],
              droppedFocus: result?.droppedFocus || [],
              existingSources: research.sources || [],
              targetFields: job?.targetFields || job?.fields || [],
              context: {
                research,
                identity,
                leadCharacters:
                  research.seriesIdentity || job?.leadCharacters,
                ...subjectIdentityFrom(research, identity || {}, {
                  leadCharacters:
                    research.seriesIdentity || job?.leadCharacters,
                }),
              },
              includeSourceDetails: isAdaptiveDebugEnabled(),
            });
          adaptiveLog(formatSourceFlowLog(job.id, sourceFlow));
          if (isAdaptiveDebugEnabled() && sourceFlow.sourceDetails?.length) {
            adaptiveLog(
              `source flow details:\n${JSON.stringify(sourceFlow.sourceDetails, null, 2)}`
            );
          }
          const mixObs = observePreparedSourceMix({
            prepared: result?.sources || [],
            targetFields: job?.targetFields || job?.fields || [],
            context: {
              research,
              identity,
              leadCharacters:
                research.seriesIdentity || job?.leadCharacters,
              ...subjectIdentityFrom(research, identity || {}, {
                leadCharacters:
                  research.seriesIdentity || job?.leadCharacters,
              }),
            },
            requestedRetrievalMode: job.retrievalMode || "general",
            preferredSourceRoles: job.preferredSourceRoles || [],
          });
          jobTrace.push({
            id: job.id,
            strategy: job.strategy,
            ok: true,
            webSearchCalls: calls,
            sourceCount: (result?.sources || []).length,
            parseStatus: result?.parseStatus || null,
            retryUsed: Boolean(result?.retryUsed),
            rawUrlCount: (result?.rawUrls || []).length,
            mergedCount: (result?.findings || []).length,
            preparedCount: (result?.sources || []).length,
            retrievalAttempts: result?.retrievalAttempts || null,
            retrievalStatus: result?.retrievalStatus || null,
            fallbackTriggered: Boolean(result?.fallbackTriggered),
            fallbackBlockedByBudget: Boolean(result?.fallbackBlockedByBudget),
            primarySearchCostUsd: result?.primarySearchCostUsd ?? null,
            fallbackSearchCostUsd: result?.fallbackSearchCostUsd ?? 0,
            totalSearchCostUsd: result?.totalSearchCostUsd ?? null,
            sourceFlow: publicSourceFlow(sourceFlow),
            ...mixObs,
          });
        } catch (err) {
          const message = err?.message || String(err);
          warnings.push(`${job.id} failed: ${message}`);
          jobTrace.push({
            id: job.id,
            strategy: job.strategy,
            ok: false,
            error: message,
          });
          adaptiveLog(`job ${job.id} failed: ${message}`);
        }
      }

      additionalSearch += roundSearch;
      additionalCost += roundCost;
      additionalIn += roundIn;
      additionalOut += roundOut;

      if (succeeded === 0) {
        stopReason = "error";
        const failedRound = {
          round,
          targetFields: jobs.flatMap((j) => j.targetFields || j.fields || []),
          jobs: jobTrace,
          webSearchCalls: roundSearch,
          newSources: 0,
          newRelevantSources: 0,
          coverageBefore,
          coverageAfter: coverageBefore,
          coverageGain: 0,
          criticalFieldsResolved: [],
          conflictsBefore,
          conflictsAfter: conflictsBefore,
          costUsd: roundCost,
          ...roundRetrievalDiagnostics(jobTrace, {
            addedCount: 0,
            relevantCount: 0,
            draftCount: 0,
          }),
        };
        attachFieldCoverageObservability(failedRound, {
          coverageBefore: coverageBeforeIntel,
          coverageAfter: coverageBeforeIntel,
          researchAfter: research,
          researchBefore: researchBeforeRound,
          identity,
          assessments: roundAssessments,
        });
        rounds.push(failedRound);
        break;
      }

      const merge = mergeAdaptiveSources(research.sources || [], roundDrafts);
      const added = merge.added || [];
      const subjectContext = {
        research,
        identity,
        leadCharacters: research.seriesIdentity || jobs[0]?.leadCharacters,
      };
      const sourceTraces = added.map((s) =>
        debugSourceEvidenceTrace(s, jobs, subjectContext)
      );
      const relevant = added.filter((s) =>
        isFollowUpSourceRelevant(s, jobs, subjectContext)
      );
      const evidenceTrace = summarizeEvidenceTrace(sourceTraces);

      if (isAdaptiveDebugEnabled()) {
        adaptiveLog(
          `source evidence trace:\n${sourceTraces
            .map(
              (t) =>
                `SOURCE: ${t.id || t.url}\n` +
                Object.entries(t.fields)
                  .map(([field, ev]) => {
                    const sub = ev.subject || {};
                    return (
                      `FIELD: ${field}\n` +
                      `subject:\n  targetMmc = ${sub.targetMmc || "—"}\n` +
                      `  detected = ${(sub.detected || []).join(", ") || "—"}\n` +
                      `  status = ${sub.status || "—"}\n` +
                      `field:\n  rawRelevance = ${ev.rawRelevance || ev.relevance}\n` +
                      `  validatedRelevance = ${ev.validatedRelevance || ev.relevance}\n` +
                      `reason:\n  ${ev.reason || ev.rejectedBecause || "—"}\n`
                    );
                  })
                  .join("\n") +
                `newRelevant: ${t.countsAsNewRelevant}`
            )
            .join("\n\n")}`
        );
      }

      adaptiveLog(
        `web search calls: ${roundSearch}\nnew sources: ${added.length}\nrelevant sources: ${relevant.length}`
      );

      const roundRecord = {
        round,
        targetFields: [...new Set(jobs.flatMap((j) => j.targetFields || j.fields || []))],
        jobs: jobTrace,
        webSearchCalls: roundSearch,
        newSources: added.length,
        newRelevantSources: relevant.length,
        coverageBefore,
        coverageAfter: coverageBefore,
        coverageGain: 0,
        criticalFieldsResolved: [],
        conflictsBefore,
        conflictsAfter: conflictsBefore,
        costUsd: roundCost,
        evidenceTrace,
        roundSourceFlow: aggregateRoundSourceFlow(jobTrace),
        ...roundRetrievalDiagnostics(jobTrace, {
          addedCount: added.length,
          relevantCount: relevant.length,
          draftCount: roundDrafts.length,
        }),
      };
      attachFieldCoverageObservability(roundRecord, {
        coverageBefore: coverageBeforeIntel,
        coverageAfter: coverageBeforeIntel,
        researchAfter: { sources: merge.sources },
        researchBefore: researchBeforeRound,
        identity,
        assessments: roundAssessments,
      });

      if (added.length === 0) {
        rounds.push(roundRecord);
        stopReason = "no_new_evidence";
        break;
      }

      if (relevant.length === 0) {
        research.sources = merge.sources;
        roundRecord.diagnostics = {
          newDirectOrSupporting: 0,
          TARGET_COVERAGE_GAIN_WITHOUT_NEW_EVIDENCE: false,
        };
        rounds.push(roundRecord);
        stopReason = "no_new_evidence";
        break;
      }

      try {
        const rebuilt = await rebuildResearchFromSources({
          identity,
          catalog,
          mofibo,
          sources: merge.sources,
          previousResearch: { ...research, sources: merge.sources },
          searchResults: jobTrace,
          synthesize: deps.synthesize,
        });
        research = rebuilt.research;
        additionalCost += rebuilt.costUsd || 0;
        additionalIn += rebuilt.inputTokens || 0;
        additionalOut += rebuilt.outputTokens || 0;
        roundRecord.costUsd += rebuilt.costUsd || 0;
      } catch (err) {
        warnings.push(`synthesis failed: ${err.message || err}`);
        research = { ...research, sources: merge.sources };
      }

      try {
        const nextAnalysis = await deps.analyze({
          research,
          catalog,
          mofibo,
          identity,
        });
        const analysisCost = Number(nextAnalysis?.meta?.estimatedCostUsd) || 0;
        additionalCost += analysisCost;
        additionalIn += Number(nextAnalysis?.meta?.inputTokens) || 0;
        additionalOut += Number(nextAnalysis?.meta?.outputTokens) || 0;
        roundRecord.costUsd += analysisCost;
        analysis = nextAnalysis;
      } catch (err) {
        warnings.push(`analysis failed: ${err.message || err}`);
        attachFieldCoverageObservability(roundRecord, {
          coverageBefore: coverageBeforeIntel,
          coverageAfter: coverageBeforeIntel,
          researchAfter: research,
          researchBefore: researchBeforeRound,
          identity,
          assessments: roundAssessments,
        });
        rounds.push(roundRecord);
        stopReason = "error";
        break;
      }

      const after = analyzeResearchNeeds({
        identity,
        research,
        assessments: assessmentsOf(analysis),
        previousRounds: [...rounds, roundRecord],
      });
      plannerCalls += 1;
      const coverageAfter = after.coverage.weightedCoverage;
      const criticalAfter = after.coverage.criticalFieldsBelowMinimum || [];
      const criticalResolved = criticalBefore.filter(
        (f) => !criticalAfter.includes(f)
      );
      const conflictsAfter = meaningfulConflictCount(after);

      roundRecord.coverageAfter = coverageAfter;
      roundRecord.coverageGain = coverageAfter - coverageBefore;
      roundRecord.criticalFieldsResolved = criticalResolved;
      roundRecord.conflictsAfter = conflictsAfter;
      if (
        relevant.length === 0 &&
        roundRecord.coverageGain >= minGain
      ) {
        warnings.push("TARGET_COVERAGE_GAIN_WITHOUT_NEW_EVIDENCE");
        roundRecord.diagnostics = {
          ...(roundRecord.diagnostics || {}),
          TARGET_COVERAGE_GAIN_WITHOUT_NEW_EVIDENCE: true,
          newDirectOrSupporting: relevant.length,
        };
      }
      attachFieldCoverageObservability(roundRecord, {
        coverageBefore: coverageBeforeIntel,
        coverageAfter: after.coverage,
        researchAfter: research,
        researchBefore: researchBeforeRound,
        identity,
        assessments: assessmentsOf(analysis),
      });
      rounds.push(roundRecord);

      adaptiveLog(
        `coverage: ${coverageBefore} → ${coverageAfter}\ncritical resolved: ${
          criticalResolved.join(", ") || "none"
        }`
      );
      const fieldLog = formatFieldCoverageSummaryLog(roundRecord.fieldCoverageSummary);
      if (fieldLog) adaptiveLog(fieldLog);

      intelligence = after;

      const afterStop = stopFromIntelligence(after);
      if (afterStop) {
        stopReason = afterStop;
        break;
      }

      if (additionalSearch >= maxSearch) {
        stopReason = "search_budget_reached";
        break;
      }
      if (additionalCost >= maxCost) {
        stopReason = "cost_budget_reached";
        break;
      }

      const conflictImproved = conflictsAfter < conflictsBefore;
      if (
        relevant.length === 0 &&
        roundRecord.coverageGain < minGain &&
        criticalResolved.length === 0 &&
        !conflictImproved
      ) {
        stopReason = "diminishing_returns";
        break;
      }
      if (
        roundRecord.coverageGain < minGain &&
        criticalResolved.length === 0 &&
        !conflictImproved
      ) {
        stopReason = "diminishing_returns";
        break;
      }

      if (round >= maxRounds) {
        stopReason = "max_rounds";
        break;
      }
    }
  } catch (err) {
    warnings.push(`adaptive loop failed: ${err.message || err}`);
    stopReason = "error";
  }

  const finalIntel = analyzeResearchNeeds({
    identity,
    research,
    assessments: assessmentsOf(analysis),
    previousRounds: rounds,
  });
  const adaptive = {
    version: ADAPTIVE_VERSION,
    enabled: true,
    initialCoverage,
    finalCoverage: finalIntel.coverage.weightedCoverage,
    targetCoverage: ADAPTIVE_TARGET_COVERAGE,
    initialResearchCostUsd: initialCost,
    additionalCostUsd: Math.round(additionalCost * 10000) / 10000,
    totalResearchCostUsd:
      Math.round((initialCost + additionalCost) * 10000) / 10000,
    additionalWebSearchCalls: additionalSearch,
    totalAdditionalWebSearchCalls: additionalSearch,
    totalWebSearchCalls: initialSearch + additionalSearch,
    totalInputTokens: initialIn + additionalIn,
    totalOutputTokens: initialOut + additionalOut,
    rounds,
    stopReason,
    warnings,
    plannerCalls,
    identityResolution,
  };

  research = attachAdaptiveMeta(research, adaptive);
  if (analysis?.meta) {
    analysis.meta.webSearchCalls = adaptive.totalWebSearchCalls;
    analysis.meta.adaptive = {
      stopReason,
      finalCoverage: adaptive.finalCoverage,
      rounds: rounds.length,
      enabled: true,
    };
  }

  adaptiveLog(
    `STOP: ${stopReason}\nAdaptive cost:\nweb/research+analysis: $${adaptive.additionalCostUsd}\ntotal: $${adaptive.totalResearchCostUsd}`
  );

  return { research, analysis, adaptive };
}
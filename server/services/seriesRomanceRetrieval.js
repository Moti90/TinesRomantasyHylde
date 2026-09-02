/**
 * Series Romance Structure 3.2 — scoped retrieval execution helpers.
 *
 * Pure helpers. No API calls. Does not mutate research objects in place.
 */

import { resolveSourceIdentity } from "./adaptiveResearch.js";
import { stableHash } from "./hash.js";
import {
  defensiveCopyRomanceScope,
  semanticPairingKey,
} from "./seriesRomancePlanning.js";
import { buildFallbackQueryHints } from "./searchRetrieval.js";

export const INVALID_ROMANCE_SCOPE_ERROR = "invalid_romance_scope";
export const SCOPE_STATUS_REQUESTED = "requested";
export const SCOPE_PROVENANCE_PLANNER = "planner_job_metadata";

const GENERIC_MEMBER_TOKENS =
  /^(the|a|an|he|she|hero|heroine|mmc|fmc|lead)$/i;

const PROTECTIVE_FIELDS = new Set([
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
]);
const AGENCY_FIELDS = new Set(["Rhysand-faktoren"]);
const FMC_FIELDS = new Set(["Kvindelig udvikling (0-5)"]);
const CHAR_FIELDS = new Set(["Karakterudvikling (0-5)"]);
const SPICE_FIELDS = new Set([
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "Romance i fokus (0-100%)",
]);
const PLOT_FIELDS = new Set([
  "Worldbuilding (0-5)",
  "Episk plot (0-5)",
  "Politiske intriger (0-5)",
  "Krig/militær (0-5)",
]);

const QUERY_HINT_CAP = 10;

function compareAscii(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function fieldSet(targetFields = []) {
  return new Set((targetFields || []).filter(Boolean));
}

function hasAny(fields, set) {
  for (const f of fields) {
    if (set.has(f)) return true;
  }
  return false;
}

export function sanitizeMemberName(name) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 40) return "";
  if (GENERIC_MEMBER_TOKENS.test(n)) return "";
  return n;
}

export function sanitizeMemberNames(memberNames) {
  const seen = new Set();
  const out = [];
  for (const raw of memberNames || []) {
    const name = sanitizeMemberName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => compareAscii(a.toLowerCase(), b.toLowerCase()));
}

export function sortTargetFields(fields = []) {
  return [...new Set((fields || []).filter(Boolean))].sort(compareAscii);
}

export function isExecutableRomanceScope(scope) {
  try {
    if (scope == null) return false;
    if (typeof scope !== "object") return false;
    const copy = defensiveCopyRomanceScope(scope);
    if (!copy) return false;
    const names = sanitizeMemberNames(copy.memberNames);
    if (!names.length) return false;
    const key = semanticPairingKey({ ...copy, memberNames: names });
    if (!key || key === "|") return false;
    return true;
  } catch {
    return false;
  }
}

export function isUnscopedRomanceJob(job) {
  return job?.romanceScope == null;
}

export function sortBookScopes(bookScopes = []) {
  const list = Array.isArray(bookScopes) ? bookScopes : [];
  return [...list]
    .map((item) => ({
      bookNumber: item?.bookNumber ?? null,
      title: String(item?.title || "").trim() || null,
    }))
    .sort((a, b) => {
      if (a.bookNumber == null && b.bookNumber == null) {
        return compareAscii(a.title || "", b.title || "");
      }
      if (a.bookNumber == null) return 1;
      if (b.bookNumber == null) return -1;
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      return compareAscii(a.title || "", b.title || "");
    });
}

export function sortArcScopes(arcScopes = []) {
  const list = Array.isArray(arcScopes) ? arcScopes : [];
  return [...list]
    .map((item) => ({
      id: String(item?.id || "").trim() || null,
      label: String(item?.label || "").trim() || null,
    }))
    .sort((a, b) => {
      const idCmp = compareAscii(
        (a.id || "").toLowerCase(),
        (b.id || "").toLowerCase()
      );
      if (idCmp !== 0) return idCmp;
      return compareAscii(
        (a.label || "").toLowerCase(),
        (b.label || "").toLowerCase()
      );
    });
}

export function normalizeStoredRomanceScope(scope) {
  try {
    const copy = defensiveCopyRomanceScope(scope);
    if (!copy) return null;
    const memberNames = sanitizeMemberNames(copy.memberNames);
    return {
      pairingId: copy.pairingId ?? null,
      memberNames,
      bookScopes: sortBookScopes(copy.bookScopes),
      arcScopes: sortArcScopes(copy.arcScopes),
      topology: copy.topology ?? null,
    };
  } catch {
    return null;
  }
}

function safeTraceValue(value, seen = new WeakSet(), depth = 0) {
  if (depth > 6) return "[max_depth]";
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => safeTraceValue(item, seen, depth + 1));
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = safeTraceValue(entry, seen, depth + 1);
  }
  return out;
}

export function safeTraceRomanceScope(scope) {
  if (scope == null) return null;
  if (typeof scope !== "object") {
    return { diagnostic: "invalid_romance_scope_type", valueType: typeof scope };
  }
  try {
    const copy = defensiveCopyRomanceScope(scope);
    if (copy) return copy;
  } catch {
    // Fall through to diagnostic snapshot.
  }
  try {
    return safeTraceValue(scope);
  } catch {
    return { diagnostic: "unreadable_romance_scope" };
  }
}

export function buildNeutralPairingPhrase(memberNames = []) {
  const names = sanitizeMemberNames(memberNames);
  if (!names.length) return "the selected romantic pairing";
  if (names.length === 1) {
    return `the romantic pairing involving "${names[0]}"`;
  }
  if (names.length === 2) {
    return `the romantic pairing between "${names[0]}" and "${names[1]}"`;
  }
  return `the romantic pairing involving ${names.map((n) => `"${n}"`).join(", ")}`;
}

function quoteSeriesTitle(title) {
  const t = String(title || "series").trim() || "series";
  return `"${t}"`;
}

function buildBookArcInstruction(scopeCopy) {
  const books = sortBookScopes(scopeCopy.bookScopes);
  const arcs = sortArcScopes(scopeCopy.arcScopes);
  const parts = [];

  for (const book of books) {
    if (book.bookNumber != null && book.title) {
      parts.push(`book ${book.bookNumber} "${book.title}"`);
    } else if (book.bookNumber != null) {
      parts.push(`book ${book.bookNumber}`);
    } else if (book.title) {
      parts.push(`book "${book.title}"`);
    }
  }
  for (const arc of arcs) {
    if (arc.id && arc.label) {
      parts.push(`arc "${arc.id}" (${arc.label})`);
    } else if (arc.id) {
      parts.push(`arc "${arc.id}"`);
    } else if (arc.label) {
      parts.push(`arc "${arc.label}"`);
    }
  }
  return parts;
}

export function buildScopeInstructionBlock(scope) {
  const copy = defensiveCopyRomanceScope(scope);
  if (!copy) return "";
  const pairingPhrase = buildNeutralPairingPhrase(copy.memberNames);
  const locationParts = buildBookArcInstruction(copy);
  const location =
    locationParts.length > 0
      ? ` Focus on evidence for ${locationParts.join(", ")} within the series.`
      : "";
  return `

Scope this search to ${pairingPhrase}.${location} Do not assume a different primary couple for this job. Do not treat internal pairing identifiers as search terms.`;
}

export function buildScopeQueryHints(scope, { seriesTitle = "series" } = {}) {
  const copy = defensiveCopyRomanceScope(scope);
  if (!copy) return [];
  const q = quoteSeriesTitle(seriesTitle);
  const pairingPhrase = buildNeutralPairingPhrase(copy.memberNames);
  const hints = [`${q} ${pairingPhrase} review`];
  const books = sortBookScopes(copy.bookScopes);
  const arcs = sortArcScopes(copy.arcScopes);
  for (const book of books) {
    if (book.bookNumber != null) {
      hints.push(`${q} ${pairingPhrase} book ${book.bookNumber} review`);
    } else if (book.title) {
      hints.push(`${q} ${pairingPhrase} "${book.title}" review`);
    }
  }
  for (const arc of arcs) {
    if (arc.label) {
      hints.push(`${q} ${pairingPhrase} "${arc.label}" review`);
    } else if (arc.id) {
      hints.push(`${q} ${pairingPhrase} arc "${arc.id}" review`);
    }
  }
  return unique(hints);
}

function boundedQueryHints(baseHints = [], scopeHints = [], cap = QUERY_HINT_CAP) {
  const primaryScopeHint = (scopeHints || [])[0] || null;
  const base = unique(baseHints || []);

  if (!primaryScopeHint) {
    return unique([...base, ...(scopeHints || [])]).slice(0, cap);
  }

  let out = base.slice(0, cap);
  if (out.includes(primaryScopeHint)) {
    return out.slice(0, cap);
  }
  if (out.length >= cap) {
    out = [...base.slice(0, cap - 1), primaryScopeHint];
  } else {
    out = [...out, primaryScopeHint];
  }
  return out.slice(0, cap);
}

export { boundedQueryHints };

export function buildScopedFallbackUserPrompt({
  identity = {},
  series = {},
  strategy = "",
  targetFields = [],
  purpose = "field",
  romanceScope,
} = {}) {
  const title = series.title || identity.series || identity.title || "the series";
  const author = series.author || identity.author || "";
  const authorBit = author ? ` by ${author}` : "";
  const fields = fieldSet(targetFields);
  const pairingPhrase = buildNeutralPairingPhrase(
    defensiveCopyRomanceScope(romanceScope)?.memberNames
  );
  const scopeBlock = buildScopeInstructionBlock(romanceScope);

  const channels = hasAny(fields, PLOT_FIELDS)
    ? "Try detailed reviews, series analyses, and series guides. Reader discussions such as Reddit or Goodreads are useful when they analyse plot or worldbuilding."
    : "Try reader discussions such as Reddit or Goodreads, as well as detailed review blogs.";

  if (
    strategy === "hero_protective_dynamic" ||
    hasAny(fields, PROTECTIVE_FIELDS)
  ) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about ${pairingPhrase} across the series, especially protective behaviour when a partner is in danger, hurt, threatened, or needs protection.

Prioritise sources that discuss concrete scenes or relationship behaviour rather than trope labels alone.

${channels}${scopeBlock}`;
  }

  if (strategy === "hero_respect_agency" || hasAny(fields, AGENCY_FIELDS)) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about whether ${pairingPhrase} shows mutual respect, independence, and equal partnership — including protection without control.

${channels}${scopeBlock}`;
  }

  if (
    strategy === "heroine_growth" ||
    hasAny(fields, FMC_FIELDS) ||
    hasAny(fields, CHAR_FIELDS)
  ) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews describing character growth and development within ${pairingPhrase}: becoming more confident, gaining independence, learning to make choices, or coming into power.

${channels}${scopeBlock}`;
  }

  if (strategy === "romance_spice" || hasAny(fields, SPICE_FIELDS)) {
    return `I am researching "${title}"${authorBit}.

Find reader reviews that describe romance focus and spice for ${pairingPhrase} in concrete terms (open door vs fade to black, chemistry, whether intimate scenes feel meaningful).

${channels}${scopeBlock}`;
  }

  return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about ${pairingPhrase} that describe concrete story or character behaviour relevant to: ${(targetFields || []).join(", ") || strategy || "the work"}.

${channels}${scopeBlock}`;
}

export function buildScopedExecutionInputs(job, { identity = {}, series = {} } = {}) {
  if (!isExecutableRomanceScope(job?.romanceScope)) return null;

  const scopeCopy = normalizeStoredRomanceScope(job.romanceScope);
  if (!scopeCopy) return null;
  const requestedScopeKey = semanticPairingKey(scopeCopy);
  const seriesTitle = series.title || identity.series || identity.title || "series";
  const scopeHints = buildScopeQueryHints(scopeCopy, { seriesTitle });
  const scopeInstruction = buildScopeInstructionBlock(scopeCopy);

  const basePrimaryPrompt = String(job.userPrompt || "");
  const basePrimaryHints =
    job.queryHints ||
    [];

  const approaches = job.retrievalApproaches || {};
  const fallbackBaseHints = buildFallbackQueryHints(approaches);

  return {
    requestedScopeKey,
    romanceScope: scopeCopy,
    primaryUserPrompt: `${basePrimaryPrompt}${scopeInstruction}`,
    primaryQueryHints: boundedQueryHints(basePrimaryHints, scopeHints),
    fallbackUserPrompt: buildScopedFallbackUserPrompt({
      identity,
      series,
      strategy: job.strategy || "",
      targetFields: job.targetFields || job.fields || [],
      purpose: "field",
      romanceScope: scopeCopy,
    }),
    fallbackQueryHints: boundedQueryHints(fallbackBaseHints, scopeHints),
  };
}

export function normalizeRetrievalAttempt(value) {
  const n = Number(value);
  return n === 2 ? 2 : 1;
}

export function normalizeRetrievalStrategy(attempt) {
  return attempt === 2 ? "broad_fallback" : "primary";
}

export function buildScopedRecordId({
  followUpJobId,
  retrievalAttempt,
  requestedScopeKey,
  sourceIdentityKey: identityKey,
}) {
  return `scoped-retrieval-${stableHash({
    followUpJobId: followUpJobId || "",
    retrievalAttempt: normalizeRetrievalAttempt(retrievalAttempt),
    requestedScopeKey: requestedScopeKey || "",
    sourceIdentityKey: identityKey || "",
  })}`;
}

export function buildScopedRetrievalRecord(preparedSource, job, round) {
  if (!preparedSource?.url) return null;
  if (!isExecutableRomanceScope(job?.romanceScope)) return null;

  const storedScope = normalizeStoredRomanceScope(job?.romanceScope);
  if (!storedScope) return null;

  const requestedScopeKey = semanticPairingKey(storedScope);
  const identity = resolveSourceIdentity(preparedSource);
  const retrievalAttempt = normalizeRetrievalAttempt(preparedSource.retrievalAttempt);
  const retrievalStrategy = normalizeRetrievalStrategy(retrievalAttempt);
  const followUpJobId = job?.id || preparedSource.followUpJobId || "";

  const id = buildScopedRecordId({
    followUpJobId,
    retrievalAttempt,
    requestedScopeKey,
    sourceIdentityKey: identity.identityKey,
  });

  return {
    id,
    sourceIdentity: {
      identityKey: identity.identityKey,
      canonicalUrl: identity.canonicalUrl || "",
    },
    source: {
      title: preparedSource.title || "Kilde",
      url: preparedSource.url,
      type: preparedSource.type || "other",
      batch: preparedSource.batch ?? null,
      summary: String(preparedSource.summary || ""),
      focus: preparedSource.focus ?? null,
    },
    requestedRomanceScope: storedScope,
    requestedScopeKey,
    scopeStatus: SCOPE_STATUS_REQUESTED,
    scopeProvenance: SCOPE_PROVENANCE_PLANNER,
    followUpJobId,
    adaptiveRound: round,
    strategy: job?.strategy || preparedSource.strategy || null,
    targetFields: sortTargetFields(job?.targetFields || job?.fields || []),
    retrievalMode: job?.retrievalMode || "general",
    retrievalAttempt,
    retrievalStrategy,
  };
}

export function buildScopedRetrievalRecords(preparedSources = [], job, round) {
  const records = [];
  for (const source of preparedSources || []) {
    const record = buildScopedRetrievalRecord(source, job, round);
    if (record) records.push(record);
  }
  return records;
}

export function sortScopedRetrievalRecords(records = []) {
  return [...records].sort((a, b) => {
    const roundCmp = (Number(a.adaptiveRound) || 0) - (Number(b.adaptiveRound) || 0);
    if (roundCmp !== 0) return roundCmp;
    const jobCmp = compareAscii(a.followUpJobId || "", b.followUpJobId || "");
    if (jobCmp !== 0) return jobCmp;
    const scopeCmp = compareAscii(
      a.requestedScopeKey || "",
      b.requestedScopeKey || ""
    );
    if (scopeCmp !== 0) return scopeCmp;
    return compareAscii(a.id || "", b.id || "");
  });
}

export function normalizeScopedRetrieval(value) {
  if (!value || typeof value !== "object") {
    return { records: [] };
  }
  const records = Array.isArray(value.records)
    ? value.records.filter((record) => record && typeof record === "object" && record.id)
    : [];
  return { records: sortScopedRetrievalRecords(records) };
}

export function mergeScopedRetrievalRecords(existingSidecar, newRecords = []) {
  const sidecar = normalizeScopedRetrieval(existingSidecar);
  const byId = new Map(sidecar.records.map((record) => [record.id, record]));
  let stored = 0;
  let skipped = 0;

  for (const record of newRecords || []) {
    if (!record?.id) continue;
    if (byId.has(record.id)) {
      skipped += 1;
      continue;
    }
    byId.set(record.id, record);
    stored += 1;
  }

  return {
    sidecar: { records: sortScopedRetrievalRecords([...byId.values()]) },
    stored,
    skipped,
    produced: (newRecords || []).filter(Boolean).length,
  };
}

export function buildInvalidRomanceScopeExecutorResult() {
  return {
    invalidRomanceScope: true,
    sources: [],
    pairing: null,
    romanceIdentity: null,
    parseStatus: null,
    retryUsed: false,
    rawUrls: [],
    findings: [],
    webSearchCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    retryInputTokens: 0,
    retryOutputTokens: 0,
    retryCostUsd: 0,
    primarySearchCostUsd: 0,
    fallbackSearchCostUsd: 0,
    totalSearchCostUsd: 0,
    costUsd: 0,
    retrievalAttempts: [],
    retrievalStatus: "invalid_romance_scope",
    fallbackTriggered: false,
    fallbackBlockedByBudget: false,
    retrievalYield: "none",
    sourceFlow: null,
    scopedRecordsProduced: 0,
  };
}

export function buildInvalidRomanceScopeJobTrace(job = {}) {
  let targetFields = [];
  try {
    targetFields = [...(job.targetFields || job.fields || [])];
  } catch {
    targetFields = [];
  }
  return {
    id: job?.id ?? null,
    strategy: job?.strategy ?? null,
    targetFields,
    romanceScope: safeTraceRomanceScope(job?.romanceScope),
    ok: false,
    error: INVALID_ROMANCE_SCOPE_ERROR,
    scopedExecutionSkipped: true,
    scopedExecutionSkipReason: INVALID_ROMANCE_SCOPE_ERROR,
    scopedRecordsProduced: 0,
    scopedRecordsStored: 0,
    scopedDuplicatesSkipped: 0,
    webSearchCalls: 0,
    sourceCount: 0,
  };
}

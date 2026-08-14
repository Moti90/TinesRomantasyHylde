/**
 * Bid 3 Fase C.1 — diversified retrieval approaches + low-yield fallback.
 * Deterministic. No API calls. Does not change evidence/coverage scoring.
 */

import { sourceDedupeKey } from "./webResearch.js";

const GENERIC_MMC = "the series' central male romantic lead";
const GENERIC_FMC = "the heroine";

const DIVERSITY_INSTRUCTION = `Use these as ALTERNATIVE search approaches.
Do not require all terms to appear together.
Do not combine every phrase into one giant AND-like query.
Try natural reader/review wording before relying on trope labels.`;

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
const READER_FIELDS = new Set([
  "Book hangover (0-5)",
  "Hvor hurtigt griber den? (0-100%)",
]);

function unique(arr) {
  return [...new Set((arr || []).filter((v) => v != null && String(v).trim()))];
}

function sanitizeName(name) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 40) return "";
  if (/^(the|a|an|he|she|hero|heroine|mmc|fmc|lead)$/i.test(n)) return "";
  return n;
}

function isResolved(leadCharacters) {
  return leadCharacters?.resolution?.resolved === true;
}

function quote(title) {
  const t = String(title || "series").trim() || "series";
  return `"${t}"`;
}

function leadLabels(leadCharacters = {}, { purpose } = {}) {
  const resolved = isResolved(leadCharacters);
  const mmc = sanitizeName(leadCharacters.mmc);
  const fmc = sanitizeName(leadCharacters.fmc);
  const named = Boolean(resolved && mmc && fmc);
  return {
    resolved,
    named,
    mmc: named ? mmc : GENERIC_MMC,
    fmc: named ? fmc : GENERIC_FMC,
    mmcName: mmc,
    fmcName: fmc,
    candidates: unique([
      !named ? mmc : null,
      ...(leadCharacters.alternatives || []).map((a) => sanitizeName(a?.name || a)),
    ]).slice(0, 2),
    purpose: purpose || "field",
  };
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

/**
 * Deterministic alternative retrieval phrasings for one focused job.
 */
export function buildRetrievalApproaches({
  identity = {},
  series = {},
  leadCharacters = {},
  targetFields = [],
  strategy = "",
  purpose = "field",
} = {}) {
  const title = series.title || identity.series || identity.title || "series";
  const q = quote(title);
  const leads = leadLabels(leadCharacters, { purpose });
  const { mmc, fmc } = leads;
  const fields = fieldSet(targetFields);
  const identityJob =
    purpose === "identity" || strategy === "series_identity_resolution";

  const readerLanguage = [];
  const sceneLanguage = [];
  const relationshipLanguage = [];
  const tropeLanguage = [];
  const discussionLanguage = [];

  if (!identityJob && !leads.named) {
    readerLanguage.push(`${q} main romantic lead heroine`);
    readerLanguage.push(`${q} heroine eventual romantic partner`);
  }

  if (identityJob) {
    readerLanguage.push(`${q} later books romantic pairing`);
    readerLanguage.push(`${q} endgame couple review`);
    sceneLanguage.push(`${q} later books who does the heroine end up with`);
    relationshipLanguage.push(`${q} central romantic pairing series spoilers`);
    relationshipLanguage.push(`${q} main couple series spoilers`);
    tropeLanguage.push(`${q} eventual partner heroine`);
    discussionLanguage.push(`${q} endgame couple reddit`);
    discussionLanguage.push(`${q} series relationship guide`);
    if (leads.fmcName) {
      readerLanguage.push(`${q} "${leads.fmcName}" endgame partner`);
    }
    if (leads.candidates.length >= 2) {
      relationshipLanguage.push(
        `${q} ${leads.candidates.map((n) => `"${n}"`).join(" ")} relationship later books`
      );
    }
  } else if (
    strategy === "hero_protective_dynamic" ||
    hasAny(fields, PROTECTIVE_FIELDS)
  ) {
    readerLanguage.push(`${q} ${mmc} protects ${fmc} review`);
    readerLanguage.push(`${q} ${mmc} keeps ${fmc} safe`);
    sceneLanguage.push(
      `${q} ${mmc} reaction when ${fmc} is hurt or threatened`
    );
    sceneLanguage.push(`${q} ${mmc} loses control when ${fmc} is hurt`);
    sceneLanguage.push(
      `${q} ${mmc} reacts violently when ${fmc} is threatened`
    );
    relationshipLanguage.push(`${q} ${mmc} ${fmc} protective relationship`);
    tropeLanguage.push(`${q} ${mmc} touch her and die`);
    tropeLanguage.push(`${q} ${mmc} goes feral ${fmc}`);
    tropeLanguage.push(`${q} ${mmc} bodyguard ${fmc}`);
    discussionLanguage.push(
      `${q} reader discussion ${mmc} ${fmc} protective`
    );
  } else if (
    strategy === "hero_respect_agency" ||
    hasAny(fields, AGENCY_FIELDS)
  ) {
    readerLanguage.push(`${q} ${mmc} respects ${fmc} choices`);
    readerLanguage.push(`${q} ${mmc} supports ${fmc} independence`);
    sceneLanguage.push(`${q} ${mmc} treats ${fmc} as an equal`);
    sceneLanguage.push(`${q} ${mmc} protective without controlling ${fmc}`);
    relationshipLanguage.push(`${q} ${mmc} ${fmc} equal partnership`);
    tropeLanguage.push(`${q} morally grey hero equal partner review`);
    discussionLanguage.push(`${q} ${mmc} ${fmc} autonomy respect reddit`);
  } else if (
    strategy === "heroine_growth" ||
    hasAny(fields, FMC_FIELDS) ||
    hasAny(fields, CHAR_FIELDS)
  ) {
    readerLanguage.push(`${q} ${fmc} becomes more confident`);
    readerLanguage.push(`${q} ${fmc} character growth review`);
    sceneLanguage.push(`${q} ${fmc} learns to make her own choices`);
    sceneLanguage.push(`${q} ${fmc} comes into her power`);
    relationshipLanguage.push(`${q} ${fmc} gains independence`);
    tropeLanguage.push(`${q} heroine growth review`);
    discussionLanguage.push(`${q} ${fmc} character arc discussion`);
  } else if (strategy === "romance_spice" || hasAny(fields, SPICE_FIELDS)) {
    readerLanguage.push(`${q} spice level review`);
    readerLanguage.push(`${q} open door or fade to black`);
    sceneLanguage.push(`${q} steamy scenes review`);
    relationshipLanguage.push(`${q} romance vs plot review`);
    tropeLanguage.push(`${q} open door romance review`);
    discussionLanguage.push(`${q} steamy romantasy reddit`);
  } else if (
    strategy === "reader_emotional_response" ||
    hasAny(fields, READER_FIELDS)
  ) {
    readerLanguage.push(`${q} book hangover review`);
    readerLanguage.push(`${q} couldn't put it down`);
    sceneLanguage.push(`${q} how quickly it grabs the reader`);
    relationshipLanguage.push(`${q} still thinking about it after finishing`);
    discussionLanguage.push(`${q} reader reactions reddit`);
  } else if (strategy === "conflict_resolution") {
    readerLanguage.push(`${q} ${mmc} protective or controlling review`);
    sceneLanguage.push(`${q} ${fmc} agency vs possessive hero`);
    relationshipLanguage.push(`${q} ${mmc} ${fmc} relationship disagreement`);
    discussionLanguage.push(`${q} character dynamic disagreement reddit`);
  } else {
    readerLanguage.push(`${q} worldbuilding plot review`);
    sceneLanguage.push(`${q} epic fantasy romance review`);
    relationshipLanguage.push(`${q} magic system review`);
    discussionLanguage.push(`${q} series analysis review`);
    if (hasAny(fields, PLOT_FIELDS)) {
      readerLanguage.push(`${q} political intrigue war review`);
    }
  }

  if (!identityJob && !leads.named) {
    readerLanguage.unshift(`${q} heroine eventual romantic partner`);
    readerLanguage.unshift(`${q} main romantic lead heroine`);
  }
  if (!identityJob && leads.candidates.length) {
    for (const n of leads.candidates) {
      discussionLanguage.push(`${q} "${n}" review`);
    }
  }

  const capBucket = (arr, n = 3) => unique(arr).slice(0, n);
  return {
    readerLanguage: capBucket(readerLanguage, 3),
    sceneLanguage: capBucket(sceneLanguage, 3),
    relationshipLanguage: capBucket(relationshipLanguage, 2),
    tropeLanguage: capBucket(tropeLanguage, 3),
    discussionLanguage: capBucket(discussionLanguage, 2),
    named: leads.named,
    mmc: leads.mmc,
    fmc: leads.fmc,
  };
}

export function flattenRetrievalApproaches(approaches = {}) {
  return unique([
    ...(approaches.readerLanguage || []).slice(0, 3),
    ...(approaches.sceneLanguage || []).slice(0, 2),
    ...(approaches.relationshipLanguage || []).slice(0, 2),
    ...(approaches.tropeLanguage || []).slice(0, 2),
    ...(approaches.discussionLanguage || []).slice(0, 2),
  ]).slice(0, 10);
}

export function diversityInstruction() {
  return DIVERSITY_INSTRUCTION;
}

export function buildFallbackUserPrompt({
  identity = {},
  series = {},
  leadCharacters = {},
  strategy = "",
  targetFields = [],
  purpose = "field",
} = {}) {
  const title = series.title || identity.series || identity.title || "the series";
  const author = series.author || identity.author || "";
  const leads = leadLabels(leadCharacters, { purpose });
  const authorBit = author ? ` by ${author}` : "";
  const identityJob =
    purpose === "identity" || strategy === "series_identity_resolution";
  const fields = fieldSet(targetFields);

  const channels = identityJob
    ? "Try series guides, wiki/fandom relationship pages, spoiler discussions, later-book reviews, and reader discussions such as Reddit or Goodreads."
    : hasAny(fields, PLOT_FIELDS)
      ? "Try detailed reviews, series analyses, and series guides. Reader discussions such as Reddit or Goodreads are useful when they analyse plot or worldbuilding."
      : "Try reader discussions such as Reddit or Goodreads, as well as detailed review blogs.";

  if (identityJob) {
    return `I am researching the series "${title}"${authorBit}.

Find spoiler-friendly evidence about the central / endgame romantic pairing across the FULL SERIES — later books, not only the first love interest in book 1.

${channels}

Prioritise sources that name the heroine and her eventual partner, or that discuss how the pairing changes after book 1.`;
  }

  if (
    strategy === "hero_protective_dynamic" ||
    hasAny(fields, PROTECTIVE_FIELDS)
  ) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about ${leads.mmc} and ${leads.fmc}'s relationship across the series, especially how he behaves when she is in danger, hurt, threatened, or needs protection.

Prioritise sources that discuss concrete scenes or relationship behaviour rather than trope labels alone.

${channels}`;
  }

  if (strategy === "hero_respect_agency" || hasAny(fields, AGENCY_FIELDS)) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about whether ${leads.mmc} respects ${leads.fmc}'s choices, supports her independence, and treats her as an equal — including protection without control.

${channels}`;
  }

  if (
    strategy === "heroine_growth" ||
    hasAny(fields, FMC_FIELDS) ||
    hasAny(fields, CHAR_FIELDS)
  ) {
    return `I am researching "${title}"${authorBit}.

Find detailed reviews describing how ${leads.fmc} grows: becoming more confident, gaining independence, learning to make her own choices, or coming into her power.

${channels}`;
  }

  if (strategy === "romance_spice" || hasAny(fields, SPICE_FIELDS)) {
    return `I am researching "${title}"${authorBit}.

Find reader reviews that describe romance focus and spice in concrete terms (open door vs fade to black, chemistry, whether intimate scenes feel meaningful).

${channels}`;
  }

  return `I am researching "${title}"${authorBit}.

Find detailed reviews or reader discussions about the series that describe concrete story or character behaviour relevant to: ${(targetFields || []).join(", ") || strategy || "the work"}.

${channels}`;
}

/**
 * Conservative retrieval-yield gate. Triggered by retrieval emptiness, not coverage.
 */
export function assessRetrievalYield({
  rawUrlCount = 0,
  mergedCount = 0,
  preparedCount = 0,
  parseStatus = null,
} = {}) {
  const raw = Number(rawUrlCount) || 0;
  const merged = Number(mergedCount) || 0;
  const prepared = Number(preparedCount) || 0;

  if (raw === 0 && merged === 0) {
    return {
      level: "zero",
      reason: "no_raw_urls_and_no_findings",
      shouldFallback: true,
      parseStatus: parseStatus || null,
    };
  }
  if (merged === 0 && prepared === 0) {
    return {
      level: "low",
      reason: "raw_urls_dropped_before_merge",
      shouldFallback: true,
      parseStatus: parseStatus || null,
    };
  }
  if (prepared === 0) {
    return {
      level: "low",
      reason: "merged_sources_dropped_before_prepare",
      shouldFallback: true,
      parseStatus: parseStatus || null,
    };
  }
  if (merged <= 1 && raw <= 2 && prepared <= 1) {
    return {
      level: "low",
      reason: "very_few_retrieved_urls",
      shouldFallback: true,
      parseStatus: parseStatus || null,
    };
  }
  return {
    level: "usable",
    reason: "enough_retrieval_for_evidence_layer",
    shouldFallback: false,
    parseStatus: parseStatus || null,
  };
}

export function extractWebSearchQueries(response) {
  const queries = [];
  for (const item of response?.output || []) {
    if (item?.type !== "web_search_call") continue;
    const q = item.action?.query || item.action?.search_query || null;
    if (q != null && String(q).trim()) queries.push(String(q).trim());
  }
  return queries.length ? queries : null;
}

export function canAffordRetrievalFallback({
  remainingSearchCalls,
  primaryWebSearchCalls = 1,
} = {}) {
  if (remainingSearchCalls == null) return true;
  const remaining = Number(remainingSearchCalls);
  if (!Number.isFinite(remaining)) return true;
  const used = Math.max(0, Number(primaryWebSearchCalls) || 0);
  return remaining - used >= 1;
}

export function retrievalStatusAfterAttempts({
  fallbackTriggered,
  fallbackBlockedByBudget,
  finalYield,
} = {}) {
  if (fallbackBlockedByBudget) return "budget_blocked_fallback";
  if (!fallbackTriggered) {
    return finalYield?.level === "usable" ? "primary_usable" : "retrieval_zero";
  }
  if (finalYield?.level === "usable") return "fallback_recovered";
  if (finalYield?.level === "zero") return "retrieval_zero";
  return "fallback_low";
}

export function classifyEvidenceOutcome({
  retrievalStatus,
  addedCount = 0,
  relevantCount = 0,
  rawUrlCount = 0,
  mergedCount = 0,
} = {}) {
  const added = Number(addedCount) || 0;
  const relevant = Number(relevantCount) || 0;
  const raw = Number(rawUrlCount) || 0;
  const merged = Number(mergedCount) || 0;
  if (
    retrievalStatus === "retrieval_zero" ||
    (raw === 0 && merged === 0 && added === 0)
  ) {
    return "retrieval_zero";
  }
  if (added === 0 && (raw > 0 || merged > 0)) return "no_new_unique_sources";
  if (added > 0 && relevant === 0) return "retrieved_but_irrelevant";
  if (relevant === 0) return "no_new_evidence";
  return "new_evidence";
}

export function tagDrafts(drafts, { attempt, strategy }) {
  return (drafts || []).map((d) => ({
    ...d,
    retrievalAttempt: d.retrievalAttempt || attempt,
    retrievalStrategy: d.retrievalStrategy || strategy,
  }));
}

export function buildFallbackQueryHints(approaches = {}) {
  return unique([
    ...(approaches.discussionLanguage || []),
    ...(approaches.relationshipLanguage || []),
    ...(approaches.readerLanguage || []).slice(0, 1),
  ]).slice(0, 4);
}

function draftIdentityKey(draft) {
  const url = typeof draft === "string" ? draft : draft?.url;
  const title = typeof draft === "string" ? "" : draft?.title;
  return sourceDedupeKey(url, String(title || "").toLowerCase());
}

function looksLikeHostnameTitle(title) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(title || "").trim());
}

function preferDraftTitle(existing, incoming) {
  const a = String(existing || "").trim();
  const b = String(incoming || "").trim();
  if (!a) return b || "Kilde";
  if (!b) return a;
  if (looksLikeHostnameTitle(a) && !looksLikeHostnameTitle(b)) return b;
  if (looksLikeHostnameTitle(b) && !looksLikeHostnameTitle(a)) return a;
  return b.length > a.length ? b : a;
}

function preferDraftSummary(existing, incoming) {
  const a = String(existing || "").trim();
  const b = String(incoming || "").trim();
  const generic = (s) => /^Fundet via /i.test(s);
  if (generic(a) && b && !generic(b)) return b;
  if (generic(b) && a && !generic(a)) return a;
  return b.length > a.length ? b : a;
}

function mergeDraftList(primaryDrafts = [], fallbackDrafts = []) {
  const byKey = new Map();
  const upsert = (draft) => {
    if (!draft?.url && !draft?.title) return;
    const key = draftIdentityKey(draft);
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...draft });
      return;
    }
    byKey.set(key, {
      ...prev,
      title: preferDraftTitle(prev.title, draft.title),
      summary: preferDraftSummary(prev.summary, draft.summary),
      type:
        prev.type === "other" && draft.type && draft.type !== "other"
          ? draft.type
          : prev.type || draft.type,
      url: prev.url || draft.url,
      retrievalAttempt: Math.min(
        Number(prev.retrievalAttempt) || 1,
        Number(draft.retrievalAttempt) || 1
      ),
      retrievalStrategy: prev.retrievalStrategy || draft.retrievalStrategy,
    });
  };
  for (const d of primaryDrafts) upsert(d);
  for (const d of fallbackDrafts) upsert(d);
  return [...byKey.values()];
}

function mergeRawUrls(primary = [], fallback = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(primary || []), ...(fallback || [])]) {
    const key = draftIdentityKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(typeof raw === "string" ? { url: raw } : { ...raw });
  }
  return out;
}

function preferPairing(primary, fallback) {
  const a = primary || null;
  const b = fallback || null;
  if (!a) return b;
  if (!b) return a;
  const score = (p) =>
    (String(p?.mmc || "").trim() ? 1 : 0) + (String(p?.fmc || "").trim() ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * Merge primary + fallback focused-search results on canonical URL.
 * Richer title/summary wins. Duplicate URLs count once.
 */
export function mergeRetrievalAttempts(primary = {}, fallback = {}) {
  const findings = mergeDraftList(
    tagDrafts(primary.findings || [], { attempt: 1, strategy: "primary" }),
    tagDrafts(fallback.findings || [], { attempt: 2, strategy: "broad_fallback" })
  );
  const rawUrls = mergeRawUrls(primary.rawUrls || [], fallback.rawUrls || []);
  return {
    id: primary.id || fallback.id,
    focus: primary.focus || fallback.focus,
    batch: primary.batch || fallback.batch,
    query: primary.query || "",
    findings,
    rawUrls,
    rawUrlCount: rawUrls.length,
    pairing: preferPairing(primary.pairing, fallback.pairing),
    parseStatus: fallback.parseStatus || primary.parseStatus || null,
    retryUsed: Boolean(primary.retryUsed || fallback.retryUsed),
    webSearchCalls:
      (Number(primary.webSearchCalls) || 0) + (Number(fallback.webSearchCalls) || 0),
    inputTokens: (Number(primary.inputTokens) || 0) + (Number(fallback.inputTokens) || 0),
    outputTokens:
      (Number(primary.outputTokens) || 0) + (Number(fallback.outputTokens) || 0),
    retryInputTokens:
      (Number(primary.retryInputTokens) || 0) +
      (Number(fallback.retryInputTokens) || 0),
    retryOutputTokens:
      (Number(primary.retryOutputTokens) || 0) +
      (Number(fallback.retryOutputTokens) || 0),
    retryCostUsd:
      (Number(primary.retryCostUsd) || 0) + (Number(fallback.retryCostUsd) || 0),
    purpose: primary.purpose || fallback.purpose,
    searchQueries: unique([
      ...(primary.searchQueries || []),
      ...(fallback.searchQueries || []),
    ]),
  };
}

export function retrievalAttemptRecord({
  attempt,
  strategy,
  result = {},
  preparedCount = 0,
  yieldLevel = null,
} = {}) {
  const queries = result.searchQueries;
  return {
    attempt,
    strategy,
    rawUrlCount: Number(result.rawUrlCount ?? result.rawUrls?.length) || 0,
    mergedCount: (result.findings || []).length,
    preparedCount,
    parseStatus: result.parseStatus || null,
    webSearchCalls: Number(result.webSearchCalls) || 0,
    searchQueries: Array.isArray(queries) && queries.length ? queries : null,
    yield: yieldLevel,
    retryUsed: Boolean(result.retryUsed),
  };
}

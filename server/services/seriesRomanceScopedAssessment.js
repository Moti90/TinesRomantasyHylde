/**
 * Series Romance Structure 6A — scoped pair/book/arc assessments.
 *
 * Pipeline-owned finalizer. Does not change research budgets, planner, or
 * public row scores. Coverage is recomputed from final research; assessments
 * live under _analysisMeta.scopedAssessments only.
 */

import { getOpenAIKey } from "./config.js";
import { stableHash } from "./hash.js";
import { SUBJECTIVE_KEYS } from "./decisionScores.js";
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  isRomanceScopePlanningReady,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "./seriesRomancePlanning.js";
import { primaryPairings } from "./seriesRomanceIdentity.js";
import { buildIdentityFingerprint } from "./seriesRomanceSubjectBinding.js";
import {
  buildScopedCoverage,
  isEligibleScopedCoverageRecord,
  scopedArcScopeKey,
  scopedBookScopeKey,
} from "./seriesRomanceScopedCoverage.js";
import {
  ANALYSIS_MODEL,
  SCOPED_ASSESSMENT_PROMPT_VERSION,
  SCOPED_ASSESSMENT_VERSION,
  SCOPED_COVERAGE_VERSION,
  estimateCostUsd,
} from "./versions.js";
import { tryExtractJson } from "./webResearch.js";
import { attachSeriesAggregation } from "./seriesRomanceAggregation.js";

export {
  SCOPED_ASSESSMENT_VERSION,
  SCOPED_ASSESSMENT_PROMPT_VERSION,
};

export const PAIRING_SCOPED_V1 = Object.freeze([
  ...ROMANCE_SCOPE_ELIGIBLE_FIELDS,
]);

export const SERIES_GLOBAL_V1 = Object.freeze(
  SUBJECTIVE_KEYS.filter((field) => !PAIRING_SCOPED_V1.includes(field))
);

const SCOPED_CONFIDENCE = Object.freeze(["low", "medium", "high"]);
const SCOPED_BASIS = Object.freeze([
  "source_consensus",
  "mixed_sources",
  "insufficient",
]);
const SCOPED_STATUS = Object.freeze(["ready", "insufficient_scope", "error"]);

function compareAscii(a, b) {
  if (a === b) return 0;
  return String(a) < String(b) ? -1 : 1;
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function defensiveCopy(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/**
 * Empty usage for paths with no actual model/API call.
 * model must be null (not ANALYSIS_MODEL) when nothing was invoked.
 */
function emptyUsage(model = null) {
  return {
    model: model == null ? null : model,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

/**
 * Remove previous scoped usage exactly once, drop dedicated counters and
 * scopedAssessments, and leave unrelated/global meta fields untouched.
 */
export function clearScopedAssessmentArtifacts(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const next = meta;
  const prevIn = Number(next.scopedAssessmentInputTokens) || 0;
  const prevOut = Number(next.scopedAssessmentOutputTokens) || 0;
  const prevCost = Number(next.scopedAssessmentEstimatedCostUsd) || 0;
  if (prevIn || prevOut || prevCost) {
    next.inputTokens = Math.max(0, (Number(next.inputTokens) || 0) - prevIn);
    next.outputTokens = Math.max(0, (Number(next.outputTokens) || 0) - prevOut);
    next.estimatedCostUsd = Math.max(
      0,
      (Number(next.estimatedCostUsd) || 0) - prevCost
    );
  }
  delete next.scopedAssessmentInputTokens;
  delete next.scopedAssessmentOutputTokens;
  delete next.scopedAssessmentEstimatedCostUsd;
  delete next.scopedAssessments;
  return next;
}

/**
 * True when an adapter result represents an actual external/injected model call.
 * missing_api_key detected before any network/API work is not a model call.
 */
function didInvokeModel(modelResult) {
  if (!modelResult || typeof modelResult !== "object") return false;
  if (modelResult.invoked === false) return false;
  if (modelResult.invoked === true) return true;
  if (modelResult.error === "missing_api_key") return false;
  // Injected stubs / real completions that returned a result count as invoked.
  return true;
}

function pairingSemanticKeyFromPairing(pairing) {
  return semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing?.members),
    bookScopes: pairing?.bookScopes || [],
    arcScopes: pairing?.arcScopes || [],
  });
}

function findPairingBySemanticKey(romance, pairKey) {
  if (!pairKey) return null;
  for (const pairing of romance?.pairings || []) {
    if (pairingSemanticKeyFromPairing(pairing) === pairKey) return pairing;
  }
  return null;
}

function memberKey(member) {
  if (!member) return null;
  const name = normalizeName(member.name).toLowerCase();
  if (!name) return null;
  const slot = member.slot === "mmc" || member.slot === "fmc" ? member.slot : "";
  return `${name}|${slot}`;
}

function bookKeysFromPairing(pairing) {
  const keys = [];
  for (const book of pairing?.bookScopes || []) {
    const key = scopedBookScopeKey(book);
    if (key) keys.push(key);
  }
  return [...new Set(keys)].sort(compareAscii);
}

/**
 * Exact v1 field taxonomy. No Spice / Romance focus at pairing scope.
 */
export function buildScopedAssessmentTaxonomy() {
  return {
    pairingScoped: [...PAIRING_SCOPED_V1],
    seriesGlobal: [...SERIES_GLOBAL_V1],
  };
}

export function isScopedField(field) {
  return PAIRING_SCOPED_V1.includes(field);
}

/**
 * Fail-closed activation: planning-ready multi-pair + current scoped coverage.
 */
export function isScopedAssessmentActivationReady({
  research = null,
  coverage = null,
  identityFingerprint = null,
} = {}) {
  const romance = research?.seriesRomanceIdentity || null;
  if (!isRomanceScopePlanningReady(romance)) return false;
  const fingerprint =
    identityFingerprint || buildIdentityFingerprint(romance);
  if (!fingerprint) return false;
  const scoped = coverage?.scoped;
  if (!scoped || scoped.active !== true) return false;
  if (scoped.version !== SCOPED_COVERAGE_VERSION) return false;
  if (!Array.isArray(scoped.cells)) return false;
  return true;
}

function emptyInsufficientAssessment({ coverageCellKeys = [], reason = "" } = {}) {
  return {
    status: "insufficient",
    score: null,
    confidence: "low",
    basis: "insufficient",
    reason: String(reason || "Ikke nok scoped evidens").slice(0, 500),
    evidenceRecordIds: [],
    evidenceIdentityKeys: [],
    conflictingRecordIds: [],
    coverageCellKeys: [...coverageCellKeys].sort(compareAscii),
  };
}

/**
 * Handbook whole-number 0..5. Non-finite → null.
 */
export function normalizeScopedScore(raw) {
  if (raw == null || raw === "") return null;
  let n = raw;
  if (typeof raw === "string") {
    const m = raw.match(/(-?\d+(?:\.\d+)?)/);
    n = m ? Number(m[1]) : NaN;
  }
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, Math.round(n)));
}

/**
 * Scoped-only normalizer. Does not use global normalizeAssessment
 * (those IDs belong to research.sources).
 */
export function normalizeScopedAssessment({
  raw = null,
  allowedRecordIds = [],
  recordById = new Map(),
  coverageCellKeys = [],
} = {}) {
  const allow = new Set(
    (allowedRecordIds || []).filter((id) => typeof id === "string" && id)
  );
  const cellKeys = [...new Set(coverageCellKeys || [])].sort(compareAscii);

  const pickAllowedIds = (ids) =>
    [
      ...new Set(
        (Array.isArray(ids) ? ids : [])
          .filter((id) => typeof id === "string" && allow.has(id))
      ),
    ].sort(compareAscii);

  if (!raw || typeof raw !== "object") {
    return emptyInsufficientAssessment({
      coverageCellKeys: cellKeys,
      reason: "Manglende scoped assessment",
    });
  }

  const evidenceRecordIds = pickAllowedIds(raw.evidenceRecordIds);
  const conflictingRecordIds = pickAllowedIds(raw.conflictingRecordIds);

  let score = normalizeScopedScore(raw.score);
  let confidence = SCOPED_CONFIDENCE.includes(raw.confidence)
    ? raw.confidence
    : "low";
  let basis = SCOPED_BASIS.includes(raw.basis)
    ? raw.basis
    : score != null
      ? "mixed_sources"
      : "insufficient";

  // Non-null score requires at least one validated allow-listed record.
  if (score != null && evidenceRecordIds.length === 0) {
    score = null;
    confidence = "low";
    basis = "insufficient";
  }

  if (score == null) {
    return emptyInsufficientAssessment({
      coverageCellKeys: cellKeys,
      reason:
        raw.reason ||
        "Ikke nok scoped evidens til score",
    });
  }

  if (basis === "insufficient") {
    return emptyInsufficientAssessment({
      coverageCellKeys: cellKeys,
      reason: raw.reason || "Insufficient scoped basis",
    });
  }

  const evidenceCount = evidenceRecordIds.length;
  if (evidenceCount <= 1 && confidence === "high") confidence = "medium";
  if (evidenceCount < 2 && confidence === "high") confidence = "medium";
  if (evidenceCount === 0) {
    confidence = "low";
    basis = "insufficient";
    return emptyInsufficientAssessment({
      coverageCellKeys: cellKeys,
      reason: raw.reason || "Ingen valideret scoped evidens",
    });
  }

  // High confidence only with consensus + multi-evidence sufficiency.
  if (confidence === "high" && basis !== "source_consensus") {
    confidence = "medium";
  }
  if (confidence === "high" && evidenceCount < 2) {
    confidence = "medium";
  }

  const evidenceIdentityKeys = [
    ...new Set(
      evidenceRecordIds
        .map((id) => {
          const rec = recordById.get(id);
          return rec?.sourceIdentity?.identityKey || null;
        })
        .filter((k) => typeof k === "string" && k.trim())
        .map((k) => k.trim())
    ),
  ].sort(compareAscii);

  return {
    status: "scored",
    score,
    confidence,
    basis,
    reason: String(raw.reason || "").slice(0, 500),
    evidenceRecordIds,
    evidenceIdentityKeys,
    conflictingRecordIds,
    coverageCellKeys: cellKeys,
  };
}

function buildSubjectKey(cell) {
  const pairKey = cell.semanticPairingKey || "";
  const field = cell.field || "";
  void field;
  if (cell.subjectType === "pairing" && cell.requirement === "required") {
    return `pairing:${pairKey}`;
  }
  if (cell.subjectType === "book") {
    const bk = scopedBookScopeKey(cell.bookScope) || "book:unknown";
    return `book:${bk}|pair:${pairKey}`;
  }
  if (cell.subjectType === "arc") {
    const ak = scopedArcScopeKey(cell.arcScope) || "arc:unknown";
    return `arc:${ak}|pair:${pairKey}`;
  }
  if (cell.subjectType === "pairing") {
    return `observed-pairing:${pairKey}|role:${cell.relationshipRole || "secondary_pairing"}`;
  }
  if (cell.subjectType === "member") {
    const mk = memberKey(cell.member) || "member:unknown";
    return `member:${mk}|pair:${pairKey}|role:${cell.relationshipRole || "member"}`;
  }
  return `observed:${cell.subjectType || "unknown"}|pair:${pairKey}|cell:${cell.key || ""}`;
}

function buildRequestId(subjectKey, field) {
  return `scoped-req-${stableHash({ subjectKey, field })}`;
}

function sanitizeSourceSummary(record) {
  if (!record) return null;
  return {
    recordId: record.id || null,
    identityKey: record.sourceIdentity?.identityKey || null,
    title: String(record.source?.title || "").slice(0, 200),
    url: String(record.source?.url || "").slice(0, 300),
    type: record.source?.type || null,
    summary: String(record.source?.summary || record.source?.snippet || "").slice(
      0,
      600
    ),
  };
}

function eligibleRecordsForCell(cell, recordById, fingerprint) {
  const ids = [...new Set(cell.recordIds || [])].sort(compareAscii);
  const out = [];
  for (const id of ids) {
    const record = recordById.get(id);
    if (!record) continue;
    if (!isEligibleScopedCoverageRecord(record, fingerprint)) continue;
    if (!Array.isArray(record.targetFields) || !record.targetFields.includes(cell.field)) {
      continue;
    }
    out.push(record);
  }
  return out;
}

/**
 * Shared deterministic 6A record index.
 * Duplicate non-empty record.id values are ambiguous and excluded entirely
 * (fail-closed, including superficially identical duplicates). Unique ids only.
 */
export function buildScopedAssessmentRecordIndex(research = null) {
  const records = Array.isArray(research?.scopedRetrieval?.records)
    ? research.scopedRetrieval.records
    : [];
  const counts = new Map();
  for (const record of records) {
    const id = record?.id;
    if (typeof id !== "string" || !id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const map = new Map();
  for (const record of records) {
    const id = record?.id;
    if (typeof id !== "string" || !id) continue;
    if (counts.get(id) !== 1) continue;
    map.set(id, record);
  }
  return map;
}

function isRequiredPrimaryPairingRequest(req) {
  return (
    req?.subjectBucket === "pairings" &&
    req?.requirement === "required" &&
    req?.subjectType === "pairing"
  );
}

function isScoredAssessment(assessment) {
  return assessment?.status === "scored" && assessment?.score != null;
}

/**
 * Code-owned assessment requests from final coverage cells.
 */
export function buildScopedAssessmentRequests({
  research = null,
  coverage = null,
  identityFingerprint = null,
  recordById = null,
} = {}) {
  const romance = research?.seriesRomanceIdentity || null;
  const fingerprint =
    identityFingerprint ||
    (romance ? buildIdentityFingerprint(romance) : null);
  const scoped = coverage?.scoped;
  if (!scoped?.active || !Array.isArray(scoped.cells)) return [];

  const records =
    recordById instanceof Map
      ? recordById
      : buildScopedAssessmentRecordIndex(research);

  const byRequest = new Map();

  for (const cell of scoped.cells) {
    if (!cell || typeof cell !== "object") continue;
    if (!isScopedField(cell.field)) continue;

    const isRequiredPairing =
      cell.requirement === "required" && cell.subjectType === "pairing";
    const isObservedDiagnostic = cell.requirement === "observed";

    if (!isRequiredPairing && !isObservedDiagnostic) continue;

    // Observed diagnostics only when an eligible coverage cell has evidence.
    if (isObservedDiagnostic) {
      const hasEvidence =
        (cell.recordIds || []).length > 0 ||
        (cell.sourceIdentityKeys || []).length > 0;
      if (!hasEvidence) continue;
    }

    const eligible = eligibleRecordsForCell(cell, records, fingerprint);
    // Observed without still-eligible records → skip.
    if (isObservedDiagnostic && eligible.length === 0) continue;

    const subjectKey = buildSubjectKey(cell);
    const requestId = buildRequestId(subjectKey, cell.field);
    const existing = byRequest.get(requestId);

    const allowedRecordIds = eligible.map((r) => r.id).sort(compareAscii);
    const allowedSourceIdentityKeys = [
      ...new Set(
        eligible
          .map((r) => r.sourceIdentity?.identityKey)
          .filter((k) => typeof k === "string" && k.trim())
          .map((k) => k.trim())
      ),
    ].sort(compareAscii);

    const sourceSummaries = eligible
      .map(sanitizeSourceSummary)
      .filter(Boolean)
      .sort((a, b) => compareAscii(a.recordId || "", b.recordId || ""));

    const pairing = findPairingBySemanticKey(romance, cell.semanticPairingKey);
    const memberNames = isRequiredPairing
      ? sortedDisplayMemberNames(pairing?.members)
      : cell.member?.name
        ? [normalizeName(cell.member.name)]
        : sortedDisplayMemberNames(pairing?.members);

    const bucket =
      isRequiredPairing
        ? "pairings"
        : cell.subjectType === "book"
          ? "books"
          : cell.subjectType === "arc"
            ? "arcs"
            : "observed";

    if (!existing) {
      byRequest.set(requestId, {
        requestId,
        subjectKey,
        subjectBucket: bucket,
        subjectType: cell.subjectType,
        relationshipRole: cell.relationshipRole || null,
        requirement: cell.requirement,
        field: cell.field,
        semanticPairingKey: cell.semanticPairingKey || null,
        memberNames: [...memberNames].sort(compareAscii),
        bookKeys: bookKeysFromPairing(pairing),
        bookKey: scopedBookScopeKey(cell.bookScope),
        bookNumber:
          cell.bookScope?.bookNumber != null &&
          Number.isFinite(Number(cell.bookScope.bookNumber))
            ? Number(cell.bookScope.bookNumber)
            : null,
        title: cell.bookScope?.title || null,
        arcKey: scopedArcScopeKey(cell.arcScope),
        label: cell.arcScope?.label || null,
        coverageCellKeys: [cell.key].filter(Boolean),
        allowedRecordIds,
        allowedSourceIdentityKeys,
        sourceSummaries,
      });
    } else {
      existing.coverageCellKeys = [
        ...new Set([...existing.coverageCellKeys, cell.key].filter(Boolean)),
      ].sort(compareAscii);
      existing.allowedRecordIds = [
        ...new Set([...existing.allowedRecordIds, ...allowedRecordIds]),
      ].sort(compareAscii);
      existing.allowedSourceIdentityKeys = [
        ...new Set([
          ...existing.allowedSourceIdentityKeys,
          ...allowedSourceIdentityKeys,
        ]),
      ].sort(compareAscii);
      const summaryMap = new Map(
        existing.sourceSummaries.map((s) => [s.recordId, s])
      );
      for (const s of sourceSummaries) summaryMap.set(s.recordId, s);
      existing.sourceSummaries = [...summaryMap.values()].sort((a, b) =>
        compareAscii(a.recordId || "", b.recordId || "")
      );
    }
  }

  return [...byRequest.values()].sort((a, b) => {
    const c = compareAscii(a.subjectKey, b.subjectKey);
    if (c !== 0) return c;
    return compareAscii(a.field, b.field);
  });
}

/**
 * Deterministic fingerprint of final scoped request inputs (no timestamps/order).
 */
export function buildScopedAssessmentInputFingerprint(requests = []) {
  const normalized = [...(requests || [])]
    .map((r) => ({
      requestId: r.requestId,
      subjectKey: r.subjectKey,
      subjectBucket: r.subjectBucket,
      field: r.field,
      semanticPairingKey: r.semanticPairingKey,
      coverageCellKeys: [...(r.coverageCellKeys || [])].sort(compareAscii),
      allowedRecordIds: [...(r.allowedRecordIds || [])].sort(compareAscii),
      allowedSourceIdentityKeys: [
        ...(r.allowedSourceIdentityKeys || []),
      ].sort(compareAscii),
      sourceSummaries: [...(r.sourceSummaries || [])]
        .map((s) => ({
          recordId: s.recordId,
          identityKey: s.identityKey,
          title: s.title,
          url: s.url,
          type: s.type,
          summary: s.summary,
        }))
        .sort((a, b) => compareAscii(a.recordId || "", b.recordId || "")),
    }))
    .sort((a, b) => {
      const c = compareAscii(a.requestId, b.requestId);
      if (c !== 0) return c;
      return compareAscii(a.field, b.field);
    });

  return stableHash({
    version: SCOPED_ASSESSMENT_VERSION,
    promptVersion: SCOPED_ASSESSMENT_PROMPT_VERSION,
    requests: normalized,
  });
}

/**
 * Reuse policy (conservative):
 * - status error → never reusable (transient / missing key / parse / API)
 * - status ready → reusable when fingerprint/version checks pass
 * - status insufficient_scope → reusable only when structurally final for the
 *   same input without needing a model retry (e.g. zero eligible evidence).
 *   If eligible evidence existed but nothing scored (or only diagnostics
 *   scored), prefer retry later on identical primary evidence.
 */
export function canReuseScopedAssessments(existing, {
  identityFingerprint,
  inputFingerprint,
} = {}) {
  if (!existing || typeof existing !== "object") return false;
  if (existing.version !== SCOPED_ASSESSMENT_VERSION) return false;
  if (existing.promptVersion !== SCOPED_ASSESSMENT_PROMPT_VERSION) return false;
  if (existing.identityFingerprint !== identityFingerprint) return false;
  if (existing.inputFingerprint !== inputFingerprint) return false;
  if (!SCOPED_STATUS.includes(existing.status)) return false;
  if (existing.status === "error") return false;
  if (existing.status === "ready") return true;
  if (existing.status === "insufficient_scope") {
    const reasons = Array.isArray(existing.reasons) ? existing.reasons : [];
    // Structurally final: no eligible evidence → model would not be called.
    if (reasons.includes("no_eligible_evidence")) return true;
    // Eligible evidence existed but no valid scored primary pairing assessments.
    if (reasons.includes("no_scored_assessments")) return false;
    if (reasons.includes("no_scored_primary_pairing_assessments")) return false;
    // Unknown insufficient reasons: prefer retry (conservative).
    return false;
  }
  return false;
}

function buildPrompt(requests) {
  const payload = requests.map((r) => ({
    requestId: r.requestId,
    field: r.field,
    subjectKey: r.subjectKey,
    subjectType: r.subjectType,
    semanticPairingKey: r.semanticPairingKey,
    memberNames: r.memberNames,
    allowedRecordIds: r.allowedRecordIds,
    sources: r.sourceSummaries,
  }));

  return `Du vurderer scoped romantasy-felter for primære pairings (og evt. diagnostics).

Regler:
- Returnér KUN JSON: { "assessments": [ ... ] }
- Hvert element SKAL have requestId fra listen. Tilføj ikke nye subjects/fields/scopes.
- score: heltal 0-5 eller null
- confidence: low|medium|high
- basis: source_consensus|mixed_sources|insufficient
- evidenceRecordIds / conflictingRecordIds: kun fra allowedRecordIds for den request
- reason: kort dansk/engelsk begrundelse
- Hvis evidens mangler: score null, confidence low, basis insufficient

Requests:
${JSON.stringify(payload, null, 2)}`;
}

/**
 * Normalize model output keyed by requestId. Fail-closed on malformed/duplicate/unknown.
 */
export function normalizeScopedAssessmentModelOutput({
  modelOutput,
  requests = [],
  recordById = new Map(),
} = {}) {
  const byId = new Map(requests.map((r) => [r.requestId, r]));
  const results = new Map();
  const reasons = [];

  let items = null;
  if (modelOutput && typeof modelOutput === "object") {
    if (Array.isArray(modelOutput.assessments)) {
      items = modelOutput.assessments;
    } else if (
      modelOutput.byRequestId &&
      typeof modelOutput.byRequestId === "object"
    ) {
      items = Object.entries(modelOutput.byRequestId).map(([requestId, body]) => ({
        ...(body && typeof body === "object" ? body : {}),
        requestId,
      }));
    }
  }

  if (!Array.isArray(items)) {
    for (const req of requests) {
      results.set(
        req.requestId,
        emptyInsufficientAssessment({
          coverageCellKeys: req.coverageCellKeys,
          reason: "Ugyldigt scoped model-output",
        })
      );
    }
    return {
      byRequestId: results,
      reasons: ["malformed_model_output"],
      failedClosed: true,
    };
  }

  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      reasons.push("non_object_item");
      continue;
    }
    const requestId = item.requestId;
    if (typeof requestId !== "string" || !byId.has(requestId)) {
      reasons.push("unknown_request_id");
      continue;
    }
    if (seen.has(requestId)) {
      reasons.push("duplicate_request_id");
      // fail closed for this request
      const req = byId.get(requestId);
      results.set(
        requestId,
        emptyInsufficientAssessment({
          coverageCellKeys: req.coverageCellKeys,
          reason: "Duplicate scoped model output for request",
        })
      );
      continue;
    }
    seen.add(requestId);
    const req = byId.get(requestId);
    results.set(
      requestId,
      normalizeScopedAssessment({
        raw: item,
        allowedRecordIds: req.allowedRecordIds,
        recordById,
        coverageCellKeys: req.coverageCellKeys,
      })
    );
  }

  for (const req of requests) {
    if (!results.has(req.requestId)) {
      results.set(
        req.requestId,
        emptyInsufficientAssessment({
          coverageCellKeys: req.coverageCellKeys,
          reason: "Manglende scoped model-svar for request",
        })
      );
      reasons.push("missing_request_id");
    }
  }

  return {
    byRequestId: results,
    reasons: [...new Set(reasons)].sort(compareAscii),
    failedClosed: reasons.includes("malformed_model_output"),
  };
}

function assembleSubjectAssessments(requests, byRequestId) {
  const pairings = new Map();
  const books = new Map();
  const arcs = new Map();
  const observed = new Map();

  for (const req of requests) {
    const assessment =
      byRequestId.get(req.requestId) ||
      emptyInsufficientAssessment({
        coverageCellKeys: req.coverageCellKeys,
      });

    if (req.subjectBucket === "pairings") {
      if (!pairings.has(req.subjectKey)) {
        pairings.set(req.subjectKey, {
          subjectKey: req.subjectKey,
          semanticPairingKey: req.semanticPairingKey,
          memberNames: [...(req.memberNames || [])].sort(compareAscii),
          bookKeys: [...(req.bookKeys || [])].sort(compareAscii),
          assessments: {},
        });
      }
      pairings.get(req.subjectKey).assessments[req.field] = assessment;
      continue;
    }

    if (req.subjectBucket === "books") {
      if (!books.has(req.subjectKey)) {
        books.set(req.subjectKey, {
          subjectKey: req.subjectKey,
          bookKey: req.bookKey,
          bookNumber: req.bookNumber,
          title: req.title,
          semanticPairingKey: req.semanticPairingKey,
          assessments: {},
        });
      }
      books.get(req.subjectKey).assessments[req.field] = assessment;
      continue;
    }

    if (req.subjectBucket === "arcs") {
      if (!arcs.has(req.subjectKey)) {
        arcs.set(req.subjectKey, {
          subjectKey: req.subjectKey,
          arcKey: req.arcKey,
          label: req.label,
          semanticPairingKey: req.semanticPairingKey,
          assessments: {},
        });
      }
      arcs.get(req.subjectKey).assessments[req.field] = assessment;
      continue;
    }

    if (!observed.has(req.subjectKey)) {
      observed.set(req.subjectKey, {
        subjectKey: req.subjectKey,
        subjectType: req.subjectType,
        relationshipRole: req.relationshipRole,
        semanticPairingKey: req.semanticPairingKey,
        memberNames: [...(req.memberNames || [])].sort(compareAscii),
        assessments: {},
      });
    }
    observed.get(req.subjectKey).assessments[req.field] = assessment;
  }

  // Ensure required pairing subjects expose all five eligible fields.
  for (const subject of pairings.values()) {
    for (const field of PAIRING_SCOPED_V1) {
      if (!subject.assessments[field]) {
        subject.assessments[field] = emptyInsufficientAssessment({
          reason: "Ingen scoped request for felt",
        });
      }
    }
    const ordered = {};
    for (const field of PAIRING_SCOPED_V1) {
      ordered[field] = subject.assessments[field];
    }
    subject.assessments = ordered;
  }

  const sortSubjects = (arr) =>
    arr.sort((a, b) => compareAscii(a.subjectKey, b.subjectKey));

  return {
    pairings: sortSubjects([...pairings.values()]),
    books: sortSubjects([...books.values()]),
    arcs: sortSubjects([...arcs.values()]),
    observed: sortSubjects([...observed.values()]),
  };
}

export function buildScopedAssessmentsBlob({
  identityFingerprint,
  topology,
  status,
  requests,
  byRequestId,
  usage,
  reasons = [],
  inputFingerprint,
} = {}) {
  const assembled = assembleSubjectAssessments(requests || [], byRequestId || new Map());
  return {
    version: SCOPED_ASSESSMENT_VERSION,
    promptVersion: SCOPED_ASSESSMENT_PROMPT_VERSION,
    identityFingerprint: identityFingerprint || "",
    inputFingerprint: inputFingerprint || "",
    topology: topology || null,
    status,
    pairings: assembled.pairings,
    books: assembled.books,
    arcs: assembled.arcs,
    observed: assembled.observed,
    usage: usage || emptyUsage(),
    reasons: [...new Set(reasons || [])].sort(compareAscii),
  };
}

async function defaultCallScopedAssessmentModel({ requests }) {
  const key = getOpenAIKey();
  if (!key) {
    return {
      ok: false,
      error: "missing_api_key",
      invoked: false,
      usage: emptyUsage(null),
      modelOutput: null,
    };
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0,
    top_p: 1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Du er en deterministisk scoped romantasy-analytiker. Samme input → samme JSON. Ingen web search. Returnér kun assessments keyed by requestId. Opfind ikke subjects, fields, record IDs eller identity keys.",
      },
      { role: "user", content: buildPrompt(requests) },
    ],
  });

  const text = completion.choices?.[0]?.message?.content;
  const modelOutput = tryExtractJson(text);
  const inputTokens = completion.usage?.prompt_tokens || 0;
  const outputTokens = completion.usage?.completion_tokens || 0;
  const usage = {
    model: completion.model || ANALYSIS_MODEL,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(ANALYSIS_MODEL, inputTokens, outputTokens),
  };

  if (!modelOutput) {
    return {
      ok: false,
      error: "parse_failure",
      invoked: true,
      usage,
      modelOutput: null,
    };
  }
  return { ok: true, error: null, invoked: true, usage, modelOutput };
}

function applyScopedUsageToMeta(meta, scopedUsage) {
  if (!meta || !scopedUsage) return meta;
  const prevIn = meta.scopedAssessmentInputTokens || 0;
  const prevOut = meta.scopedAssessmentOutputTokens || 0;
  const prevCost = meta.scopedAssessmentEstimatedCostUsd || 0;
  const nextIn = scopedUsage.inputTokens || 0;
  const nextOut = scopedUsage.outputTokens || 0;
  const nextCost = scopedUsage.estimatedCostUsd || 0;
  return {
    ...meta,
    scopedAssessmentInputTokens: nextIn,
    scopedAssessmentOutputTokens: nextOut,
    scopedAssessmentEstimatedCostUsd: nextCost,
    inputTokens: Math.max(0, (meta.inputTokens || 0) - prevIn + nextIn),
    outputTokens: Math.max(0, (meta.outputTokens || 0) - prevOut + nextOut),
    estimatedCostUsd: Math.max(
      0,
      (meta.estimatedCostUsd || 0) - prevCost + nextCost
    ),
  };
}

function withSeriesAggregation(result, research, deps = {}) {
  const scopedAssessmentsChanged = Boolean(result.changed);
  const attach =
    typeof deps.attachSeriesAggregation === "function"
      ? deps.attachSeriesAggregation
      : attachSeriesAggregation;
  try {
    const aggregationDeps =
      deps.aggregationDeps && typeof deps.aggregationDeps === "object"
        ? deps.aggregationDeps
        : {};
    const agg = attach({
      research,
      analysis: result.analysis,
      deps: aggregationDeps,
    });
    return {
      ...result,
      analysis: agg.analysis,
      changed: Boolean(result.changed || agg.changed),
      scopedAssessmentsChanged,
      aggregationChanged: Boolean(agg.changed),
      aggregationReused: Boolean(agg.reused),
      aggregationInactive: Boolean(agg.inactive),
      aggregationError: false,
    };
  } catch {
    // Aggregation must never break scoped finalization or leave a stale blob.
    let nextAnalysis = result.analysis;
    let aggregationChanged = false;
    const meta = result.analysis?.meta;
    if (meta && typeof meta === "object" && meta.seriesAggregation) {
      const nextMeta = { ...meta };
      delete nextMeta.seriesAggregation;
      nextAnalysis = { ...result.analysis, meta: nextMeta };
      aggregationChanged = true;
    }
    return {
      ...result,
      analysis: nextAnalysis,
      changed: Boolean(result.changed || aggregationChanged),
      scopedAssessmentsChanged,
      aggregationChanged,
      aggregationReused: false,
      aggregationInactive: true,
      aggregationError: true,
    };
  }
}

/**
 * Soft finalizer: never throws into the pipeline.
 * Inactive paths omit scopedAssessments (no inactive blob).
 * Structure 6B aggregation attaches after scoped assessments settle.
 */
export async function finalizeScopedAssessments({
  research = null,
  analysis = null,
  identity = null,
  deps = {},
} = {}) {
  const callModel = deps.callScopedAssessmentModel || defaultCallScopedAssessmentModel;
  const baseMeta = analysis?.meta ? defensiveCopy(analysis.meta) : {};
  if (!baseMeta || typeof baseMeta !== "object") {
    return withSeriesAggregation(
      {
        analysis,
        changed: false,
        modelCalls: 0,
        modelAttempted: false,
        reused: false,
      },
      research,
      deps
    );
  }

  const existingScoped = baseMeta.scopedAssessments
    ? defensiveCopy(baseMeta.scopedAssessments)
    : null;
  // When 6A regenerates, strip prior aggregation so 6B recomputes against fresh 6A.
  // Reuse path returns the original analysis (aggregation preserved for 6B validation).
  if (baseMeta.seriesAggregation) {
    delete baseMeta.seriesAggregation;
  }

  const romance = research?.seriesRomanceIdentity || null;
  let coverage;
  try {
    // Narrow equivalent of calculateResearchCoverage(...).scoped against FINAL research.
    const scoped = buildScopedCoverage({ research });
    coverage = scoped ? { scoped } : {};
  } catch {
    coverage = null;
  }

  const fingerprint = romance ? buildIdentityFingerprint(romance) : null;
  const active = isScopedAssessmentActivationReady({
    research,
    coverage,
    identityFingerprint: fingerprint,
  });

  if (!active) {
    if (existingScoped) {
      clearScopedAssessmentArtifacts(baseMeta);
      if (baseMeta.seriesAggregation) delete baseMeta.seriesAggregation;
      return withSeriesAggregation(
        {
          analysis: { ...analysis, meta: baseMeta },
          changed: true,
          modelCalls: 0,
          modelAttempted: false,
          reused: false,
          inactive: true,
        },
        research,
        deps
      );
    }
    return withSeriesAggregation(
      {
        analysis,
        changed: false,
        modelCalls: 0,
        modelAttempted: false,
        reused: false,
        inactive: true,
      },
      research,
      deps
    );
  }

  const recordById = buildScopedAssessmentRecordIndex(research);
  let requests = buildScopedAssessmentRequests({
    research,
    coverage,
    identityFingerprint: fingerprint,
    recordById,
  });
  let inputFingerprint = buildScopedAssessmentInputFingerprint(requests);

  if (
    canReuseScopedAssessments(existingScoped, {
      identityFingerprint: fingerprint,
      inputFingerprint,
    })
  ) {
    return withSeriesAggregation(
      {
        analysis,
        changed: false,
        modelCalls: 0,
        modelAttempted: false,
        reused: true,
        inactive: false,
      },
      research,
      deps
    );
  }

  const topology = romance?.topology || null;
  const evidenceRequests = requests.filter(
    (r) => (r.allowedRecordIds || []).length > 0
  );

  let usage = emptyUsage(null);
  let byRequestId = new Map();
  let reasons = [];
  let status = "ready";
  let modelCalls = 0;
  let modelAttempted = false;

  // Seed all requests as insufficient; overwrite with model results.
  for (const req of requests) {
    byRequestId.set(
      req.requestId,
      emptyInsufficientAssessment({
        coverageCellKeys: req.coverageCellKeys,
        reason:
          (req.allowedRecordIds || []).length === 0
            ? "Ingen eligible scoped evidens"
            : "Afventer scoped model-svar",
      })
    );
  }

  if (evidenceRequests.length === 0) {
    status = "insufficient_scope";
    reasons = ["no_eligible_evidence"];
    // Ensure required pairing shells exist even with zero evidence.
    if (requests.length === 0) {
      for (const pairing of primaryPairings(romance)) {
        const pairKey = pairingSemanticKeyFromPairing(pairing);
        if (!pairKey) continue;
        for (const field of PAIRING_SCOPED_V1) {
          const subjectKey = `pairing:${pairKey}`;
          const requestId = buildRequestId(subjectKey, field);
          requests.push({
            requestId,
            subjectKey,
            subjectBucket: "pairings",
            subjectType: "pairing",
            relationshipRole: "another_primary_pairing",
            requirement: "required",
            field,
            semanticPairingKey: pairKey,
            memberNames: sortedDisplayMemberNames(pairing.members),
            bookKeys: bookKeysFromPairing(pairing),
            bookKey: null,
            bookNumber: null,
            title: null,
            arcKey: null,
            label: null,
            coverageCellKeys: [],
            allowedRecordIds: [],
            allowedSourceIdentityKeys: [],
            sourceSummaries: [],
          });
          byRequestId.set(
            requestId,
            emptyInsufficientAssessment({
              reason: "Ingen eligible scoped evidens",
            })
          );
        }
      }
      requests.sort((a, b) => {
        const c = compareAscii(a.subjectKey, b.subjectKey);
        if (c !== 0) return c;
        return compareAscii(a.field, b.field);
      });
      inputFingerprint = buildScopedAssessmentInputFingerprint(requests);
    }
  } else {
    modelAttempted = true;
    try {
      const modelResult = await callModel({ requests: evidenceRequests });
      const invoked = didInvokeModel(modelResult);
      modelCalls = invoked ? 1 : 0;
      if (invoked) {
        usage = modelResult?.usage || emptyUsage(ANALYSIS_MODEL);
      } else {
        usage = emptyUsage(null);
      }
      if (!modelResult?.ok) {
        // missing_api_key / parse / API failures are execution errors, not scope.
        status = "error";
        reasons = [modelResult?.error || "model_failure"];
        if (!invoked) usage = emptyUsage(null);
        for (const req of evidenceRequests) {
          byRequestId.set(
            req.requestId,
            emptyInsufficientAssessment({
              coverageCellKeys: req.coverageCellKeys,
              reason: `Scoped assessment error: ${reasons[0]}`,
            })
          );
        }
      } else {
        const normalized = normalizeScopedAssessmentModelOutput({
          modelOutput: modelResult.modelOutput,
          requests: evidenceRequests,
          recordById,
        });
        for (const [id, assessment] of normalized.byRequestId.entries()) {
          byRequestId.set(id, assessment);
        }
        reasons = normalized.reasons || [];
        if (normalized.failedClosed) {
          status = "error";
          reasons = [...reasons, "malformed_model_output"];
        } else {
          const anyScored = [...byRequestId.values()].some(isScoredAssessment);
          const anyScoredPrimary = requests.some((req) => {
            if (!isRequiredPrimaryPairingRequest(req)) return false;
            return isScoredAssessment(byRequestId.get(req.requestId));
          });
          // Ready requires main primary-pairing value; diagnostic-only scores
          // may remain in books/arcs/observed but do not make the blob ready.
          status = anyScoredPrimary ? "ready" : "insufficient_scope";
          if (!anyScoredPrimary) {
            reasons = [
              ...reasons,
              anyScored
                ? "no_scored_primary_pairing_assessments"
                : "no_scored_assessments",
            ];
          }
        }
      }
    } catch (err) {
      // Exception after entering the model path: count as an attempted invocation
      // when we cannot prove the adapter failed closed before any call.
      modelCalls = 1;
      status = "error";
      reasons = ["model_exception"];
      usage = emptyUsage(null);
      for (const req of evidenceRequests) {
        byRequestId.set(
          req.requestId,
          emptyInsufficientAssessment({
            coverageCellKeys: req.coverageCellKeys,
            reason: `Scoped assessment error: ${err?.message || "unknown"}`,
          })
        );
      }
    }
  }

  const scopedAssessments = buildScopedAssessmentsBlob({
    identityFingerprint: fingerprint,
    topology,
    status,
    requests,
    byRequestId,
    usage,
    reasons,
    inputFingerprint,
  });

  const nextMeta = applyScopedUsageToMeta(
    { ...baseMeta, scopedAssessments },
    usage
  );

  return withSeriesAggregation(
    {
      analysis: {
        ...analysis,
        meta: nextMeta,
      },
      changed: true,
      modelCalls,
      modelAttempted,
      reused: false,
      inactive: false,
      scopedAssessments,
    },
    research,
    deps
  );
}

/**
 * Observability helper: attach scoped usage without double-counting costs
 * already folded into analysis.meta totals. Clears stale scoped keys when
 * the current meta has no scopedAssessments.
 */
export function mergeScopedUsageIntoPipelineUsage(usage, analysisMeta) {
  if (!usage || typeof usage !== "object") return usage;
  const base = { ...usage };
  delete base.scopedAssessmentTokens;
  delete base.scopedAssessmentEstimatedCostUsd;
  const scoped = analysisMeta?.scopedAssessments?.usage;
  if (!scoped) return base;
  return {
    ...base,
    scopedAssessmentTokens: {
      in: scoped.inputTokens || 0,
      out: scoped.outputTokens || 0,
    },
    scopedAssessmentEstimatedCostUsd: scoped.estimatedCostUsd || 0,
  };
}

/**
 * Series Romance Structure 5A/5B — pairing-aware scoped coverage observability
 * plus pure required-cell progress helpers for Structure 5B loop continuation.
 *
 * Pure helpers. Additive coverage.scoped only.
 * Gap/planner ownership stays in adaptiveResearch.js; this module exposes
 * before/after required-cell comparison for the adaptive loop.
 */

import { stableHash } from "./hash.js";
import {
  ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE,
  ADAPTIVE_VERSION,
  SCOPED_COVERAGE_VERSION,
  SUBJECT_BINDING_VERSION,
} from "./versions.js";
import {
  ROMANCE_SCOPE_ELIGIBLE_FIELDS,
  isRomanceScopePlanningReady,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "./seriesRomancePlanning.js";
import {
  primaryPairings,
  PAIRING_RELATIONS,
} from "./seriesRomanceIdentity.js";
import { pairingHasScope } from "./seriesRomanceDiscovery.js";
import { buildIdentityFingerprint } from "./seriesRomanceSubjectBinding.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
  isReaderExperienceSource,
  classifySourceRole,
} from "./evidenceRelevance.js";
import { evaluateEvidenceQualityForField } from "./evidenceQuality.js";
import {
  MMC_BOUND_FIELDS,
  FMC_BOUND_FIELDS,
  fieldSubjectRequirement,
} from "./sourceSubject.js";
import {
  canonicalizeUrl,
  classifySourceType,
  sourceDedupeKey,
} from "./webResearch.js";

const SCOPED_COMPONENT_MAX = 84; // 45 + 18 + 15 + 6
const STRONG_SUBJECTIVE_TYPES = new Set([
  "blog",
  "forum",
  "goodreads",
  "professional",
]);

function compareAscii(a, b) {
  if (a === b) return 0;
  return String(a) < String(b) ? -1 : 1;
}

function roundScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function scopedSourceIdentityKey(source) {
  if (!source) return "";
  const fallback = source.id ? `id:${source.id}` : "";
  return sourceDedupeKey(source.url, fallback);
}

function scopedSourceDomain(source) {
  try {
    const url = canonicalizeUrl(source?.url) || source?.url || "";
    if (!url) return "";
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function scopedSourceTypeOf(source) {
  return (
    source?.type ||
    classifySourceType(source?.url, source?.title, source?.type) ||
    "other"
  );
}

/** Local copy of calculateEvidenceDiversity to avoid circular imports. */
function scopedEvidenceDiversity(sources) {
  const byKey = new Map();
  for (const s of sources || []) {
    const key = scopedSourceIdentityKey(s);
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
    const domain = scopedSourceDomain(s);
    if (domain) domains.set(domain, (domains.get(domain) || 0) + 1);
    const type = scopedSourceTypeOf(s);
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

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function nameLower(name) {
  return normalizeName(name).toLowerCase();
}

function pairingSemanticKey(pairing) {
  return semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing?.members),
    bookScopes: pairing?.bookScopes || [],
    arcScopes: pairing?.arcScopes || [],
  });
}

function bookKey(book) {
  if (!book || typeof book !== "object") return null;
  if (book.bookNumber != null && Number.isFinite(Number(book.bookNumber))) {
    return `book:${Number(book.bookNumber)}`;
  }
  const title = normalizeName(book.title).toLowerCase();
  return title ? `title:${title}` : null;
}

function arcKey(arc) {
  if (!arc || typeof arc !== "object") return null;
  if (arc.id) return `arc:${String(arc.id).toLowerCase()}`;
  if (arc.label) return `arcLabel:${String(arc.label).toLowerCase()}`;
  return null;
}

function memberKey(member) {
  if (!member) return null;
  const name = nameLower(member.name);
  if (!name) return null;
  const slot = member.slot === "mmc" || member.slot === "fmc" ? member.slot : "";
  return `${name}|${slot}`;
}

function cloneBookScope(book) {
  if (!book) return null;
  return {
    bookNumber: book.bookNumber ?? null,
    title: book.title || null,
  };
}

function cloneArcScope(arc) {
  if (!arc) return null;
  return {
    id: arc.id || null,
    label: arc.label || null,
  };
}

function cloneMember(member) {
  if (!member) return null;
  return {
    name: normalizeName(member.name),
    slot: member.slot === "mmc" || member.slot === "fmc" ? member.slot : null,
  };
}

/**
 * Canonical cell key. pairingId / timestamps / array order excluded.
 */
export function buildScopedCellKey({
  field,
  subjectType,
  semanticPairingKey: pairKey = null,
  member = null,
  bookScope = null,
  arcScope = null,
} = {}) {
  return stableHash({
    field: String(field || ""),
    subjectType: subjectType || "",
    semanticPairingKey: pairKey || null,
    memberKey: memberKey(member),
    bookKey: bookKey(bookScope),
    arcKey: arcKey(arcScope),
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

function relationshipRoleForPrimary(pairing) {
  if (
    pairing?.prominence === "secondary" ||
    pairing?.relation === PAIRING_RELATIONS.SECONDARY
  ) {
    return "secondary_pairing";
  }
  return "another_primary_pairing";
}

function emptyCellShell({
  key,
  requirement,
  field,
  subjectType,
  semanticPairingKey: pairKey,
  pairingId,
  member,
  bookScope,
  arcScope,
  relationshipRole,
}) {
  return {
    key,
    requirement,
    field,
    subjectType,
    semanticPairingKey: pairKey ?? null,
    pairingId: pairingId ?? null,
    member: cloneMember(member),
    bookScope: cloneBookScope(bookScope),
    arcScope: cloneArcScope(arcScope),
    relationshipRole: relationshipRole ?? null,
    coverageScore: 0,
    directEvidenceCount: 0,
    supportingEvidenceCount: 0,
    sourceIdentityKeys: [],
    recordIds: [],
    stopQualitySatisfied: false,
    covered: false,
    gapReasons: [],
    _evidence: new Map(), // identityKey -> { bucket, source, recordId, role }
  };
}

function ensureCell(map, spec) {
  const key = spec.key || buildScopedCellKey(spec);
  if (!map.has(key)) {
    map.set(key, emptyCellShell({ ...spec, key }));
  }
  return map.get(key);
}

/**
 * Direct/supporting strength only (weak/contextual = 0). Max 45.
 */
export function scopedEvidenceStrengthPoints(directCount, supportingCount) {
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
  return pts;
}

/**
 * Existing diversityPoints semantics. Max 18.
 */
export function scopedIndependencePoints(diversity, relevantCount) {
  if (relevantCount === 0) return 0;
  let domainPts =
    diversity.uniqueDomains >= 3 ? 12 : diversity.uniqueDomains === 2 ? 8 : 3;
  const relevantTypes = (diversity.sourceTypes || []).filter((t) =>
    STRONG_SUBJECTIVE_TYPES.has(t)
  );
  const typePts =
    relevantTypes.length >= 3 ? 6 : relevantTypes.length === 2 ? 4 : 1;
  if (
    diversity.dominantDomainShare >= 0.8 &&
    diversity.independentIdentities >= 2
  ) {
    domainPts = Math.min(domainPts, 4);
  }
  return domainPts + typePts;
}

export function scopedSpecificityPoints(identityCount) {
  if (identityCount <= 0) return 0;
  if (identityCount === 1) return 8;
  return 15;
}

export function scopedStopQualitySatisfied({
  directSources = [],
  supportingSources = [],
} = {}) {
  if (directSources.length >= 1) return true;
  const independentSupporting = supportingSources.filter((s) => {
    const role = classifySourceRole(s);
    return role !== "study_guide" && role !== "encyclopedia";
  });
  return independentSupporting.length >= 2;
}

function scoreCell(cell) {
  const evidence = [...(cell._evidence?.values() || [])];
  const direct = evidence.filter((e) => e.bucket === "direct");
  const supporting = evidence.filter((e) => e.bucket === "supporting");
  const sources = evidence.map((e) => e.source);
  const diversity = scopedEvidenceDiversity(sources);
  const directCount = direct.length;
  const supportingCount = supporting.length;
  const identityCount = evidence.length;
  const hasReader = sources.some((s) => isReaderExperienceSource(s));

  const strength = scopedEvidenceStrengthPoints(directCount, supportingCount);
  const independence = scopedIndependencePoints(diversity, identityCount);
  const specificity = scopedSpecificityPoints(identityCount);
  const readerDiversity = hasReader && identityCount > 0 ? 6 : 0;
  const raw = strength + independence + specificity + readerDiversity;
  const coverageScore =
    identityCount === 0
      ? 0
      : roundScore((100 * raw) / SCOPED_COMPONENT_MAX);

  const stopQualitySatisfied = scopedStopQualitySatisfied({
    directSources: direct.map((e) => e.source),
    supportingSources: supporting.map((e) => e.source),
  });
  const covered =
    cell.requirement === "required" &&
    coverageScore >= ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE &&
    stopQualitySatisfied;

  const gapReasons = [];
  if (cell.requirement === "required" && !covered) {
    if (identityCount === 0) gapReasons.push("no_direct_evidence");
    else if (directCount === 0) gapReasons.push("supporting_only");
    if (coverageScore < ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE) {
      gapReasons.push("low_coverage");
      gapReasons.push("critical_field");
    }
    if (!stopQualitySatisfied) gapReasons.push("missing_stop_quality");
  }

  const identityKeys = evidence
    .map((e) => e.identityKey)
    .filter(Boolean)
    .sort(compareAscii);
  const recordIds = [...new Set(evidence.map((e) => e.recordId).filter(Boolean))]
    .sort(compareAscii);

  return {
    key: cell.key,
    requirement: cell.requirement,
    field: cell.field,
    subjectType: cell.subjectType,
    semanticPairingKey: cell.semanticPairingKey,
    pairingId: cell.pairingId,
    member: cell.member,
    bookScope: cell.bookScope,
    arcScope: cell.arcScope,
    relationshipRole: cell.relationshipRole,
    coverageScore,
    directEvidenceCount: directCount,
    supportingEvidenceCount: supportingCount,
    sourceIdentityKeys: identityKeys,
    recordIds,
    stopQualitySatisfied,
    covered: cell.requirement === "required" ? covered : false,
    gapReasons: [...new Set(gapReasons)].sort(compareAscii),
  };
}

/**
 * Derive mmc/fmc evaluation identity from a binding + parent pairing.
 * Returns null if required slot cannot be deduced uniquely for the field.
 */
export function scopedEvalIdentityForBinding(binding, pairing, field) {
  const requirement = fieldSubjectRequirement(field);
  const members = [
    ...(binding?.members || []),
    ...(pairing?.members || []),
  ];
  const bySlot = { mmc: null, fmc: null };
  for (const m of members) {
    const slot = m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null;
    const name = normalizeName(m?.name);
    if (!slot || !name) continue;
    if (bySlot[slot] && nameLower(bySlot[slot]) !== nameLower(name)) {
      // Conflicting slot assignment — fail closed for this binding/field.
      bySlot[slot] = null;
      return null;
    }
    bySlot[slot] = name;
  }

  // Pairing binding without explicit slots: use pairing members.
  if (binding?.subjectType === "pairing" && pairing) {
    for (const m of pairing.members || []) {
      const slot = m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null;
      const name = normalizeName(m?.name);
      if (slot && name && !bySlot[slot]) bySlot[slot] = name;
    }
  }

  if (binding?.subjectType === "member") {
    const m = binding.members?.[0];
    const slot = m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null;
    const name = normalizeName(m?.name);
    if (slot && name) bySlot[slot] = name;
  }

  if (requirement === "mmc" && !bySlot.mmc) return null;
  if (requirement === "fmc" && !bySlot.fmc) return null;

  return {
    mmc: bySlot.mmc || "",
    fmc: bySlot.fmc || "",
    alternatives: [],
  };
}

function isMmcField(field) {
  return MMC_BOUND_FIELDS.has(field);
}

function isFmcField(field) {
  return FMC_BOUND_FIELDS.has(field);
}

function findPairingBySemanticKey(romance, key) {
  if (!key) return null;
  const matches = (romance?.pairings || []).filter(
    (p) => pairingSemanticKey(p) === key
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Whether a binding may contribute to a required pairing cell for `field`.
 * Returns { contributeRequiredPairing, observedSpecs }.
 */
export function classifyBindingContribution(binding, field, romance) {
  const out = { contributeRequiredPairing: false, observedSpecs: [] };
  if (!binding || !field) return out;

  const role = binding.relationshipRole;
  const subjectType = binding.subjectType;
  const pairKey = binding.semanticPairingKey || null;
  const pairing = findPairingBySemanticKey(romance, pairKey);

  // ALT LI — observed member only; never lift parent required.
  if (role === "alternative_love_interest") {
    out.observedSpecs.push({
      subjectType: "member",
      semanticPairingKey: pairKey,
      pairingId: binding.pairingId || pairing?.id || null,
      member: binding.members?.[0] || null,
      bookScope: null,
      arcScope: null,
      relationshipRole: role,
    });
    return out;
  }

  const isSecondaryPairing =
    role === "secondary_pairing" || pairing?.prominence === "secondary";

  // Secondary pairing binding → observed pairing-cell only.
  if (subjectType === "pairing" && isSecondaryPairing) {
    out.observedSpecs.push({
      subjectType: "pairing",
      semanticPairingKey: pairKey,
      pairingId: binding.pairingId || pairing?.id || null,
      member: null,
      bookScope: null,
      arcScope: null,
      relationshipRole: "secondary_pairing",
    });
    return out;
  }

  // Secondary member → observed member-cell only (never required).
  if (subjectType === "member" && isSecondaryPairing) {
    const m = binding.members?.[0];
    const slot = m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null;
    if (!slot || !pairKey) return out;
    const mmcOk = isMmcField(field) && slot === "mmc";
    const fmcOk = isFmcField(field) && slot === "fmc";
    if (!mmcOk && !fmcOk) return out;
    out.observedSpecs.push({
      subjectType: "member",
      semanticPairingKey: pairKey,
      pairingId: binding.pairingId || pairing?.id || null,
      member: m,
      bookScope: null,
      arcScope: null,
      relationshipRole: role || "secondary_pairing",
    });
    return out;
  }

  if (subjectType === "series_global") {
    return out;
  }

  if (subjectType === "book" || subjectType === "arc") {
    if (!pairKey || !pairing) return out;
    const scope =
      subjectType === "book"
        ? binding.bookScopes?.[0] || null
        : binding.arcScopes?.[0] || null;
    if (!scope) return out;
    out.observedSpecs.push({
      subjectType,
      semanticPairingKey: pairKey,
      pairingId: binding.pairingId || pairing.id || null,
      member: null,
      bookScope: subjectType === "book" ? scope : null,
      arcScope: subjectType === "arc" ? scope : null,
      relationshipRole: binding.relationshipRole || null,
    });
    return out;
  }

  if (subjectType === "member") {
    const m = binding.members?.[0];
    const slot = m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null;
    if (!slot || !pairKey) return out;

    const mmcOk = isMmcField(field) && slot === "mmc";
    const fmcOk = isFmcField(field) && slot === "fmc";
    if (!mmcOk && !fmcOk) return out;

    out.observedSpecs.push({
      subjectType: "member",
      semanticPairingKey: pairKey,
      pairingId: binding.pairingId || pairing?.id || null,
      member: m,
      bookScope: null,
      arcScope: null,
      relationshipRole: role || null,
    });

    if (pairing?.prominence === "primary" && pairingHasScope(pairing)) {
      out.contributeRequiredPairing = true;
    }
    return out;
  }

  if (subjectType === "pairing") {
    if (!pairKey || !pairing) return out;
    if (pairing.prominence !== "primary" || !pairingHasScope(pairing)) {
      return out;
    }

    const slots = (pairing.members || []).map((m) => m?.slot);
    const hasMmc =
      slots.includes("mmc") ||
      (binding.members || []).some((m) => m.slot === "mmc");
    const hasFmc =
      slots.includes("fmc") ||
      (binding.members || []).some((m) => m.slot === "fmc");

    if (isMmcField(field) && !hasMmc) return out;
    if (isFmcField(field) && !hasFmc) return out;

    out.contributeRequiredPairing = true;
    return out;
  }

  return out;
}

function recordIsEligible(record, fingerprint) {
  if (!record || typeof record !== "object") return false;
  if (!Array.isArray(record.targetFields)) return false;
  if (!record.source || typeof record.source !== "object") return false;
  if (!record.sourceIdentity || typeof record.sourceIdentity !== "object") {
    return false;
  }
  if (
    typeof record.sourceIdentity.identityKey !== "string" ||
    !record.sourceIdentity.identityKey.trim()
  ) {
    return false;
  }

  const binding = record.subjectBinding;
  if (!binding || typeof binding !== "object") return false;
  if (!Array.isArray(binding.bindings)) return false;
  if (binding.version !== SUBJECT_BINDING_VERSION) return false;
  if (binding.identityFingerprint !== fingerprint) return false;
  if (binding.status !== "resolved") return false;
  return true;
}

function adaptRecordSource(record) {
  const source = record.source;
  // Structure 3.2 owns canonical identity — no URL/id fallback here.
  const identityKey = String(record.sourceIdentity.identityKey).trim();
  return {
    id: record.id || null,
    title: source.title || "",
    url: source.url || "",
    type:
      source.type ||
      classifySourceType(source.url, source.title, source.type) ||
      "other",
    summary: source.summary || "",
    snippet: source.snippet || "",
    batch: source.batch || null,
    focus: source.focus || null,
    _identityKey: identityKey,
  };
}

const BUCKET_RANK = Object.freeze({
  direct: 2,
  supporting: 1,
});

/**
 * Deterministic winner for the same cellKey + identityKey.
 * direct > supporting; ties broken by stable semantic fields (never input order).
 */
export function pickScopedEvidenceWinner(a, b) {
  if (!a) return b;
  if (!b) return a;
  const rankA = BUCKET_RANK[a.bucket] || 0;
  const rankB = BUCKET_RANK[b.bucket] || 0;
  if (rankA !== rankB) return rankA > rankB ? a : b;

  const keys = [
    ["role", a.role || "", b.role || ""],
    ["recordId", a.recordId || "", b.recordId || ""],
    ["url", canonicalizeUrl(a.source?.url) || a.source?.url || "", canonicalizeUrl(b.source?.url) || b.source?.url || ""],
    ["title", a.source?.title || "", b.source?.title || ""],
    ["summary", a.source?.summary || "", b.source?.summary || ""],
  ];
  for (const [, left, right] of keys) {
    const cmp = compareAscii(String(left), String(right));
    if (cmp < 0) return a;
    if (cmp > 0) return b;
  }
  return a;
}

function addEvidenceToCell(cell, candidate) {
  if (!cell || !candidate?.identityKey || !candidate.bucket) return;
  const existing = cell._evidence.get(candidate.identityKey);
  const winner = pickScopedEvidenceWinner(existing, candidate);
  cell._evidence.set(candidate.identityKey, winner);
}

function finalizeCells(cellMap) {
  const cells = [...cellMap.values()].map(scoreCell);
  cells.sort((a, b) => {
    const keys = [
      "requirement",
      "field",
      "subjectType",
      "semanticPairingKey",
      "key",
    ];
    for (const k of keys) {
      const cmp = compareAscii(String(a[k] ?? ""), String(b[k] ?? ""));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return cells;
}

function buildSummary(cells, primaryTotal) {
  const required = cells.filter((c) => c.requirement === "required");
  const covered = required.filter((c) => c.covered);
  const primaryKeys = new Set(
    required
      .filter((c) => c.subjectType === "pairing" && c.semanticPairingKey)
      .map((c) => c.semanticPairingKey)
  );
  // A primary pairing is "covered" when ALL its required field cells are covered.
  let primaryPairingsCovered = 0;
  for (const key of primaryKeys) {
    const pairCells = required.filter(
      (c) => c.subjectType === "pairing" && c.semanticPairingKey === key
    );
    if (pairCells.length && pairCells.every((c) => c.covered)) {
      primaryPairingsCovered += 1;
    }
  }

  const avg =
    required.length === 0
      ? 0
      : roundScore(
          required.reduce((sum, c) => sum + c.coverageScore, 0) / required.length
        );

  return {
    requiredCellCount: required.length,
    coveredCellCount: covered.length,
    primaryPairingsTotal: primaryTotal,
    primaryPairingsCovered,
    allRequiredCellsCovered:
      required.length > 0 && covered.length === required.length,
    requiredCoverageAverage: avg,
  };
}

/**
 * Build additive scoped coverage observability.
 * Returns null when scoped coverage is not active (legacy callers omit the field).
 */
export function buildScopedCoverage({
  research = null,
  seriesRomanceIdentity = null,
} = {}) {
  const romance =
    seriesRomanceIdentity || research?.seriesRomanceIdentity || null;

  if (!isRomanceScopePlanningReady(romance)) {
    return null;
  }

  const fingerprint = buildIdentityFingerprint(romance);
  const primaries = eligiblePrimaryPairings(romance);
  const cellMap = new Map();

  // Materialize required cells even with zero records.
  for (const pairing of primaries) {
    const pairKey = pairingSemanticKey(pairing);
    const role = relationshipRoleForPrimary(pairing);
    for (const field of ROMANCE_SCOPE_ELIGIBLE_FIELDS) {
      ensureCell(cellMap, {
        requirement: "required",
        field,
        subjectType: "pairing",
        semanticPairingKey: pairKey,
        pairingId: pairing.id || null,
        member: null,
        bookScope: null,
        arcScope: null,
        relationshipRole: role,
      });
    }
  }

  const records = Array.isArray(research?.scopedRetrieval?.records)
    ? research.scopedRetrieval.records
    : [];

  for (const record of records) {
    if (!recordIsEligible(record, fingerprint)) continue;
    const targetFields = new Set(
      record.targetFields.filter((f) =>
        ROMANCE_SCOPE_ELIGIBLE_FIELDS.includes(f)
      )
    );
    if (!targetFields.size) continue;

    const adapted = adaptRecordSource(record);

    for (const field of targetFields) {
      for (const binding of record.subjectBinding.bindings) {
        const contribution = classifyBindingContribution(
          binding,
          field,
          romance
        );

        const pairing = findPairingBySemanticKey(
          romance,
          binding.semanticPairingKey
        );

        let evaluation = null;
        let quality = null;

        if (binding.relationshipRole === "alternative_love_interest") {
          // Observed only: relevance without lead subject gate (no pairing lift).
          evaluation = evaluateSourceForField({
            source: adapted,
            field,
            context: {},
          });
        } else if (
          binding.subjectType === "book" ||
          binding.subjectType === "arc"
        ) {
          evaluation = evaluateSourceForField({
            source: adapted,
            field,
            context: {},
          });
        } else {
          const evalIdentity = scopedEvalIdentityForBinding(
            binding,
            pairing,
            field
          );
          if (!evalIdentity) continue;
          evaluation = evaluateSourceForField({
            source: adapted,
            field,
            context: {
              mmc: evalIdentity.mmc,
              fmc: evalIdentity.fmc,
              alternatives: [],
            },
          });
        }

        if (!isFieldSpecificEvidence(evaluation)) continue;
        quality = evaluateEvidenceQualityForField({
          source: adapted,
          field,
          relevance: evaluation.relevance,
        });
        if (!quality?.eligible || !quality.coverageBucket) continue;

        const evidencePayload = {
          identityKey: adapted._identityKey,
          bucket: quality.coverageBucket,
          source: adapted,
          recordId: record.id,
          role: classifySourceRole(adapted),
        };

        if (contribution.contributeRequiredPairing && pairing) {
          const pairKey = pairingSemanticKey(pairing);
          const required = ensureCell(cellMap, {
            requirement: "required",
            field,
            subjectType: "pairing",
            semanticPairingKey: pairKey,
            pairingId: pairing.id || null,
            member: null,
            bookScope: null,
            arcScope: null,
            relationshipRole: relationshipRoleForPrimary(pairing),
          });
          addEvidenceToCell(required, evidencePayload);
        }

        for (const spec of contribution.observedSpecs) {
          const observed = ensureCell(cellMap, {
            requirement: "observed",
            field,
            ...spec,
          });
          addEvidenceToCell(observed, evidencePayload);
        }
      }
    }
  }

  const cells = finalizeCells(cellMap);
  const summary = buildSummary(cells, primaries.length);

  return {
    version: SCOPED_COVERAGE_VERSION,
    active: true,
    cells,
    summary,
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

/**
 * Attach scoped coverage onto a legacy coverage object (defensive copy).
 * When inactive, returns coverage unchanged (no scoped key).
 */
export function attachScopedCoverage(coverage, { research, seriesRomanceIdentity } = {}) {
  const scoped = buildScopedCoverage({
    research,
    seriesRomanceIdentity:
      seriesRomanceIdentity || research?.seriesRomanceIdentity,
  });
  if (!scoped) return coverage;
  return {
    ...coverage,
    scoped,
  };
}

/**
 * Sorted unique source identities across required cells only.
 * Prefer collectRequiredScopedContributionKeys for productivity deltas —
 * the same identity may legitimately contribute to multiple cells.
 */
export function collectRequiredScopedIdentityKeys(scoped) {
  const keys = new Set();
  if (!scoped?.active) return [];
  for (const cell of scoped.cells || []) {
    if (cell?.requirement !== "required") continue;
    for (const id of cell.sourceIdentityKeys || []) {
      if (id) keys.add(id);
    }
  }
  return [...keys].sort(compareAscii);
}

/**
 * Deterministic required-cell evidence contributions: cellKey + sourceIdentityKey.
 * Same source identity in two required cells yields two contribution keys.
 */
export function collectRequiredScopedContributionKeys(scoped) {
  const keys = new Set();
  if (!scoped?.active) return [];
  for (const cell of scoped.cells || []) {
    if (cell?.requirement !== "required") continue;
    const cellKey = cell.key || "";
    if (!cellKey) continue;
    for (const id of cell.sourceIdentityKeys || []) {
      if (id) keys.add(`${cellKey}\u0000${id}`);
    }
  }
  return [...keys].sort(compareAscii);
}

export function summarizeScopedRequiredState(scoped) {
  if (!scoped?.active) {
    return {
      contributionKeys: [],
      requiredCoverage: 0,
      cellsCovered: 0,
    };
  }
  return {
    contributionKeys: collectRequiredScopedContributionKeys(scoped),
    requiredCoverage: Number(scoped.summary?.requiredCoverageAverage) || 0,
    cellsCovered: Number(scoped.summary?.coveredCellCount) || 0,
  };
}

/**
 * Pure before/after comparison for required scoped cells.
 * Contribution/coverage gain is order-invariant (set/scalar based).
 *
 * Observability fields scopedRequiredIdentities* count required-cell
 * contributions (cellKey + sourceIdentityKey pairs), not unique source
 * identities alone — so a source already present in cell A still counts
 * when it newly contributes to required cell B.
 */
export function compareScopedRequiredProgress(beforeScoped, afterScoped) {
  const before = summarizeScopedRequiredState(beforeScoped);
  const after = summarizeScopedRequiredState(afterScoped);
  const beforeSet = new Set(before.contributionKeys);
  const added = after.contributionKeys.filter((key) => !beforeSet.has(key));
  const coverageGain = after.requiredCoverage - before.requiredCoverage;
  return {
    scopedRequiredIdentitiesBefore: before.contributionKeys.length,
    scopedRequiredIdentitiesAfter: after.contributionKeys.length,
    scopedRequiredIdentitiesAdded: added.length,
    scopedRequiredCoverageBefore: before.requiredCoverage,
    scopedRequiredCoverageAfter: after.requiredCoverage,
    scopedRequiredCoverageGain: coverageGain,
    scopedRequiredCellsCoveredBefore: before.cellsCovered,
    scopedRequiredCellsCoveredAfter: after.cellsCovered,
    scopedProductive: added.length > 0 || coverageGain > 0,
  };
}

export function emptyScopedRoundObservability() {
  return {
    scopedRequiredIdentitiesBefore: 0,
    scopedRequiredIdentitiesAfter: 0,
    scopedRequiredIdentitiesAdded: 0,
    scopedRequiredCoverageBefore: 0,
    scopedRequiredCoverageAfter: 0,
    scopedRequiredCoverageGain: 0,
    scopedRequiredCellsCoveredBefore: 0,
    scopedRequiredCellsCoveredAfter: 0,
    scopedOnlyRound: false,
    scopedProductive: false,
  };
}

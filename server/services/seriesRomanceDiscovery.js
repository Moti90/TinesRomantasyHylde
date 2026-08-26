/**
 * Series Romance Structure 2 — topology discovery and deterministic validation.
 *
 * Does not write research.seriesIdentity. Does not change retrieval, coverage,
 * or scoring. Model topology labels are hints; classifyRomanceTopology is
 * authoritative.
 */

import {
  ALTERNATIVE_LOVE_INTEREST,
  EVIDENCE_REF_NAMESPACES,
  PAIRING_RELATIONS,
  ROMANCE_DISCOVERY_SOURCES,
  emptyRomanceDiscovery,
  emptySeriesRomanceIdentity,
  isPreservableRomanceIdentity,
  memberBySlot,
  normalizeRomancePairing,
  normalizeSeriesRomanceIdentity,
  primaryPairings,
  uniqueEvidenceRefs,
  withRomanceObservability,
} from "./seriesRomanceIdentity.js";
import { IDENTITY_RESOLUTION_VERSION } from "./versions.js";
import { canonicalizeUrl } from "./webResearch.js";

const SWITCH_RE =
  /\b(switch|replac|former partner|early (love|relationship)|triangle|rival|ex[- ]lover)\b/i;

function unique(arr) {
  return [...new Set((arr || []).filter((v) => v != null && v !== ""))];
}

function asString(value) {
  return String(value || "").trim();
}

function memberNames(pairing) {
  return new Set(
    (pairing?.members || []).map((m) => asString(m.name).toLowerCase()).filter(Boolean)
  );
}

function sharesMember(a, b) {
  const names = memberNames(a);
  for (const n of memberNames(b)) {
    if (names.has(n)) return true;
  }
  return false;
}

export function pairingScopeKeys(pairing) {
  const keys = [];
  for (const book of pairing?.bookScopes || []) {
    if (book.bookNumber != null) keys.push(`book:${book.bookNumber}`);
    else if (book.title) keys.push(`title:${String(book.title).toLowerCase()}`);
  }
  for (const arc of pairing?.arcScopes || []) {
    if (arc.id) keys.push(`arc:${String(arc.id).toLowerCase()}`);
    else if (arc.label) keys.push(`arcLabel:${String(arc.label).toLowerCase()}`);
  }
  return unique(keys);
}

export function pairingHasScope(pairing) {
  return pairingScopeKeys(pairing).length > 0;
}

function scopesOverlap(a, b) {
  const other = new Set(pairingScopeKeys(b));
  return pairingScopeKeys(a).some((k) => other.has(k));
}

/**
 * Structured series-level support for a single primary pairing.
 * `basis`, topology labels and other model prose are never sufficient.
 * A single arcScope is not enough: the repo cannot verify that one arc
 * covers multiple books. Mapped evidence ids/urls are not series-level
 * proof unless they also carry distinct bookScopes.
 */
export function pairingHasSeriesLevelEvidence(pairing) {
  const bookKeys = unique(
    (pairing?.bookScopes || [])
      .map((book) => {
        if (book.bookNumber != null) return `book:${book.bookNumber}`;
        const title = asString(book.title).toLowerCase();
        return title ? `title:${title}` : null;
      })
      .filter(Boolean)
  );
  return bookKeys.length >= 2;
}

function reclassifyUnscopedAnotherPrimary(pairing) {
  if (
    pairing.relation === PAIRING_RELATIONS.ANOTHER_PRIMARY &&
    !pairingHasScope(pairing)
  ) {
    return { ...pairing, relation: null };
  }
  return pairing;
}

function looksLikePartnerSwitch(primaries) {
  if (primaries.length < 2) return false;
  const sets = primaries.map(memberNames);
  let common = [...sets[0]];
  for (const set of sets.slice(1)) {
    common = common.filter((n) => set.has(n));
  }
  if (common.length !== 1) return false;
  const switchBasis = primaries.some((p) =>
    SWITCH_RE.test((p.basis || []).join(" "))
  );
  const allAnotherPrimary = primaries.every(
    (p) => p.relation === PAIRING_RELATIONS.ANOTHER_PRIMARY
  );
  const anyOverlap = primaries.some((p, i) =>
    primaries.some((q, j) => i < j && scopesOverlap(p, q))
  );
  if (anyOverlap || switchBasis || !allAnotherPrimary) return true;
  return false;
}

function competingSameScope(primaries) {
  for (let i = 0; i < primaries.length; i += 1) {
    for (let j = i + 1; j < primaries.length; j += 1) {
      if (!sharesMember(primaries[i], primaries[j])) continue;
      if (scopesOverlap(primaries[i], primaries[j])) return true;
      if (!pairingHasScope(primaries[i]) && !pairingHasScope(primaries[j])) {
        return true;
      }
    }
  }
  return false;
}

function distinctNonCompetingScopes(primaries) {
  if (primaries.some((p) => !pairingHasScope(p))) return false;
  for (let i = 0; i < primaries.length; i += 1) {
    for (let j = i + 1; j < primaries.length; j += 1) {
      if (scopesOverlap(primaries[i], primaries[j])) return false;
    }
  }
  return true;
}

function overlappingMixedPattern(pairings) {
  const legit = (pairings || []).filter(
    (p) => p.prominence === "primary" || p.prominence === "secondary"
  );
  if (legit.length < 2) return false;
  let disjointOverlap = false;
  for (let i = 0; i < legit.length; i += 1) {
    for (let j = i + 1; j < legit.length; j += 1) {
      if (!scopesOverlap(legit[i], legit[j])) continue;
      if (!sharesMember(legit[i], legit[j])) disjointOverlap = true;
    }
  }
  return disjointOverlap;
}

/**
 * Deterministic topology from pairings/scopes. Ignores claimed labels.
 * Pairing array order must not change the result.
 */
export function classifyRomanceTopology(pairings = []) {
  const primaries = pairings.filter((p) => p.prominence === "primary");
  if (!primaries.length) {
    return {
      topology: "unknown",
      resolved: false,
      reason: "no_primary_pairing",
    };
  }
  if (primaries.length === 1) {
    if (overlappingMixedPattern(pairings)) {
      return {
        topology: "ensemble_mixed",
        resolved: true,
        reason: "ensemble_overlapping_scopes",
      };
    }
    if (pairingHasSeriesLevelEvidence(primaries[0])) {
      return {
        topology: "single_couple",
        resolved: true,
        reason: "single_couple_series_scope",
      };
    }
    return {
      topology: "unknown",
      resolved: false,
      reason: "insufficient_series_scope",
    };
  }
  if (looksLikePartnerSwitch(primaries)) {
    return {
      topology: "unknown",
      resolved: false,
      reason: "partner_switch_not_rotating",
    };
  }
  if (competingSameScope(primaries) && !overlappingMixedPattern(pairings)) {
    return {
      topology: "unknown",
      resolved: false,
      reason: "competing_same_scope",
    };
  }
  if (distinctNonCompetingScopes(primaries)) {
    return {
      topology: "rotating_couples",
      resolved: true,
      reason: "rotating_distinct_scopes",
    };
  }
  if (overlappingMixedPattern(pairings)) {
    return {
      topology: "ensemble_mixed",
      resolved: true,
      reason: "ensemble_overlapping_scopes",
    };
  }
  return {
    topology: "unknown",
    resolved: false,
    reason: "insufficient_topology_evidence",
  };
}

/**
 * Validate claimed topology against pairing evidence. Downgrades to unknown
 * when the label is inconsistent; preserves pairings.
 */
export function validateRomanceTopology(raw = {}) {
  const claimed = asString(raw.topology) || "unknown";
  const pairings = (Array.isArray(raw.pairings) ? raw.pairings : [])
    .map((p, i) => normalizeRomancePairing(p, i))
    .filter(Boolean)
    .map(reclassifyUnscopedAnotherPrimary);
  const classified = classifyRomanceTopology(pairings);
  let reason = classified.reason;
  if (
    claimed &&
    claimed !== "unknown" &&
    claimed !== classified.topology
  ) {
    reason = `${classified.reason}; claimed_${claimed}_rejected`;
  }
  const coverage =
    !pairings.length
      ? "none"
      : classified.topology === "single_couple" && classified.resolved
        ? "single_couple"
        : classified.topology === "rotating_couples" ||
            classified.topology === "ensemble_mixed"
          ? classified.resolved
            ? "multi_pairing"
            : "partial"
          : "partial";
  return withRomanceObservability({
    topology: classified.topology,
    pairings,
    resolution: {
      resolved: classified.resolved,
      coverage,
      reason,
    },
  });
}

function singularPairingFromLegacyShape(src, index = 0) {
  if (!src || typeof src !== "object") return null;
  const mmc = asString(src.mmc || src.maleLead);
  const fmc = asString(src.fmc || src.femaleLead);
  const members = Array.isArray(src.members) && src.members.length
    ? src.members
    : [
        ...(fmc ? [{ name: fmc, slot: "fmc" }] : []),
        ...(mmc ? [{ name: mmc, slot: "mmc" }] : []),
      ];
  if (!members.length) return null;
  return normalizeRomancePairing(
    {
      id: src.id,
      members,
      bookScopes: src.bookScopes,
      arcScopes: src.arcScopes,
      prominence: src.prominence || "primary",
      relation: src.relation || null,
      confidence: src.confidence,
      basis: src.basis || [],
      alternatives: src.alternatives || [],
      evidenceUrls: src.evidenceUrls || [],
      evidenceFindingIndexes: src.evidenceFindingIndexes || [],
      evidenceSourceIds: src.evidenceSourceIds || [],
    },
    index
  );
}

/**
 * Extract a romance-identity draft from structured identity-search JSON.
 * Accepts new multi-pairing output and old singular `{ pairing, findings }`.
 * Does not validate topology — call validateRomanceTopology after.
 */
export function romanceIdentityFromStructuredOutput(parsed = {}) {
  if (!parsed || typeof parsed !== "object") {
    return emptySeriesRomanceIdentity({ reason: "empty_structured_output" });
  }
  if (parsed.seriesRomanceIdentity && typeof parsed.seriesRomanceIdentity === "object") {
    return normalizeSeriesRomanceIdentity(parsed.seriesRomanceIdentity);
  }
  const fromArray = (Array.isArray(parsed.pairings) ? parsed.pairings : [])
    .map((p, i) => normalizeRomancePairing(p, i))
    .filter(Boolean);
  const singular = singularPairingFromLegacyShape(parsed.pairing || parsed);
  const pairings = fromArray.length ? fromArray : singular ? [singular] : [];
  return normalizeSeriesRomanceIdentity({
    topology: parsed.topology || "unknown",
    pairings,
    resolution: parsed.resolution || {
      resolved: false,
      reason: "structured_output",
    },
  });
}

export function pairingHintFromRomance(romance) {
  const pairings = [...(romance?.pairings || [])];
  const primaries = pairings.filter((p) => p.prominence === "primary");
  const list = (primaries.length ? primaries : pairings)
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const pairing = list[0];
  if (!pairing) return null;
  const named = (pairing.members || []).map((m) => m.name).filter(Boolean);
  const mmc = memberBySlot(pairing, "mmc")?.name || named[1] || "";
  const fmc = memberBySlot(pairing, "fmc")?.name || named[0] || "";
  if (!mmc && !fmc) return null;
  return {
    mmc,
    fmc,
    confidence: pairing.confidence || "low",
    basis: [...(pairing.basis || [])],
    alternatives: (pairing.alternatives || []).map((a) => ({
      name: a.name,
      role: a.originalRole || a.role || ALTERNATIVE_LOVE_INTEREST,
    })),
  };
}

const EXECUTION_FAILURE_REASONS = new Set(["topology_discovery_failed"]);
const PARSER_RETRIEVAL_FAILURE_REASONS = new Set([
  "failed",
  "raw_only",
  "parse_failed",
]);
const GENERIC_DISCOVERY_REASONS = new Set([
  "unspecified",
  "provided",
  "legacy_projection",
  "structured",
  "json_fallback",
  "repaired",
]);

export function discoveryReasonRank(reason) {
  const r = String(reason || "").trim();
  if (!r) return 4;
  if (EXECUTION_FAILURE_REASONS.has(r)) return 0;
  if (PARSER_RETRIEVAL_FAILURE_REASONS.has(r)) return 1;
  if (GENERIC_DISCOVERY_REASONS.has(r)) return 3;
  return 2;
}

export function pickDiscoveryReason(...candidates) {
  let best = null;
  let bestRank = 5;
  for (const c of candidates) {
    const r = String(c || "").trim();
    if (!r) continue;
    const rank = discoveryReasonRank(r);
    if (rank < bestRank) {
      best = r;
      bestRank = rank;
    }
  }
  return best;
}

export function normalizeDiscoveryFindings(findings = []) {
  const stored = [];
  const seen = new Set();
  for (const f of findings || []) {
    if (!f || typeof f !== "object") continue;
    const canon = canonicalizeUrl(f.url);
    if (canon) {
      if (seen.has(canon)) continue;
      seen.add(canon);
    }
    stored.push({
      url: f.url || null,
      title: f.title || "",
      summary: f.summary || "",
      type: f.type || null,
    });
  }
  return stored;
}

function researchSourceByCanonical(researchSources, canon) {
  if (!canon) return null;
  return (
    (researchSources || []).find(
      (s) => s?.id && canonicalizeUrl(s.url) === canon
    ) || null
  );
}

function storedFindingIndex(storedFindings, canon) {
  if (!canon) return -1;
  return storedFindings.findIndex((f) => canonicalizeUrl(f.url) === canon);
}

/**
 * Bind pairing evidence to server-validated, namespaced refs.
 * Model-generated evidenceSourceIds are never kept. Invalid refs are dropped
 * without dropping the pairing.
 */
export function mapRomanceEvidence(
  romance,
  { findings = [], sources = [], researchSources } = {}
) {
  const normalized = normalizeSeriesRomanceIdentity(romance);
  const storedFindings = normalizeDiscoveryFindings(findings);
  const researchBag = researchSources || sources || [];
  const pairings = normalized.pairings.map((pairing) => {
    const canonUrls = [];
    const seenCanon = new Set();
    const addUrl = (url) => {
      const canon = canonicalizeUrl(url);
      if (!canon || seenCanon.has(canon)) return;
      seenCanon.add(canon);
      canonUrls.push(canon);
    };
    for (const url of pairing.evidenceUrls || []) addUrl(url);
    for (const index of pairing.evidenceFindingIndexes || []) {
      if (!Number.isInteger(Number(index))) continue;
      const finding = findings[Number(index)];
      if (finding?.url) addUrl(finding.url);
    }
    const refs = [];
    const remappedIndexes = [];
    for (const canon of canonUrls) {
      const researchHit = researchSourceByCanonical(researchBag, canon);
      if (researchHit?.id) {
        refs.push({
          namespace: EVIDENCE_REF_NAMESPACES.RESEARCH_SOURCES,
          id: String(researchHit.id),
        });
      }
      const storedIndex = storedFindingIndex(storedFindings, canon);
      if (storedIndex >= 0) {
        refs.push({
          namespace: EVIDENCE_REF_NAMESPACES.DISCOVERY_FINDINGS,
          index: storedIndex,
          url: canonicalizeUrl(storedFindings[storedIndex].url) || canon,
        });
        remappedIndexes.push(storedIndex);
      }
    }
    return {
      ...pairing,
      evidenceSourceIds: [],
      evidenceUrls: canonUrls,
      evidenceFindingIndexes: unique(remappedIndexes),
      evidenceRefs: uniqueEvidenceRefs(refs),
    };
  });
  return withRomanceObservability({
    ...normalized,
    pairings,
    resolution: romance.resolution || normalized.resolution,
    discoveryEvidence: {
      findings: storedFindings,
    },
  });
}

/**
 * Attach a validated discovery result. Never writes seriesIdentity.
 * Does not replace a richer existing romance identity with a weaker one.
 */
export function attachDiscoveredRomanceIdentity(research, romance) {
  if (!research || typeof research !== "object") return research;
  const incoming = withRomanceObservability(romance);
  const existing = research.seriesRomanceIdentity;
  if (
    isPreservableRomanceIdentity(existing) &&
    !isPreservableRomanceIdentity(incoming)
  ) {
    research.seriesRomanceIdentity = withRomanceObservability(existing);
    return research;
  }
  research.seriesRomanceIdentity = incoming;
  return research;
}

function isSeriesIdentity(identity) {
  if (identity?.isSeries === true) return true;
  const series = String(identity?.series || "").trim();
  const title = String(identity?.title || "").trim();
  if (series && title && series.toLowerCase() !== title.toLowerCase()) return true;
  if (series && identity?.firstBook) return true;
  return Boolean(series);
}

const RESOLVED_TOPOLOGIES = new Set([
  "single_couple",
  "rotating_couples",
  "ensemble_mixed",
]);

/**
 * Deterministic topology-discovery decision. Does not infer provenance from
 * topology or pairing count. Legacy seriesIdentity.resolved does not block.
 */
export function romanceTopologyDiscoveryDecision({
  identity,
  seriesRomanceIdentity,
  identityVersion = IDENTITY_RESOLUTION_VERSION,
  allowRetry = false,
} = {}) {
  if (!isSeriesIdentity(identity)) {
    return { trigger: false, reason: "not_series" };
  }
  if (!seriesRomanceIdentity) {
    return { trigger: true, reason: "missing_romance_identity" };
  }
  const discovery = seriesRomanceIdentity.discovery;
  const source = discovery?.source || null;
  const attempted = discovery?.attempted === true;
  const version = discovery?.version || null;
  const topologyAware =
    source === ROMANCE_DISCOVERY_SOURCES.TOPOLOGY_DISCOVERY && attempted;

  if (!topologyAware) {
    if (source === ROMANCE_DISCOVERY_SOURCES.LEGACY_PROJECTION) {
      return { trigger: true, reason: "legacy_projection_only" };
    }
    return { trigger: true, reason: "missing_topology_discovery" };
  }

  if (version && version !== identityVersion) {
    return { trigger: true, reason: "newer_identity_version" };
  }

  const topologyResolved =
    discovery?.resolved === true &&
    RESOLVED_TOPOLOGIES.has(seriesRomanceIdentity.topology);

  if (topologyResolved) {
    return { trigger: false, reason: "already_discovered_resolved" };
  }

  if (allowRetry) {
    return { trigger: true, reason: "refresh_retry_unknown" };
  }
  return { trigger: false, reason: "already_attempted_unresolved" };
}

export function shouldTriggerRomanceTopologyDiscovery(args = {}) {
  return romanceTopologyDiscoveryDecision(args).trigger === true;
}

export function needsRomanceTopologyDiscovery(args = {}) {
  return shouldTriggerRomanceTopologyDiscovery(args);
}

export function stampTopologyDiscovery(romance, over = {}) {
  const base = romance || emptySeriesRomanceIdentity();
  const resolved =
    over.resolved != null
      ? over.resolved === true
      : base.resolution?.resolved === true &&
        RESOLVED_TOPOLOGIES.has(base.topology);
  return withRomanceObservability({
    ...base,
    discovery: emptyRomanceDiscovery({
      source: ROMANCE_DISCOVERY_SOURCES.TOPOLOGY_DISCOVERY,
      version: over.version || base.discovery?.version || IDENTITY_RESOLUTION_VERSION,
      attempted: true,
      resolved,
      attemptedAt:
        over.attemptedAt ||
        base.discovery?.attemptedAt ||
        new Date().toISOString(),
      reason: pickDiscoveryReason(
        over.reason,
        base.discovery?.reason,
        base.resolution?.reason
      ),
    }),
    discoveryEvidence: over.discoveryEvidence || base.discoveryEvidence,
  });
}

export { primaryPairings };

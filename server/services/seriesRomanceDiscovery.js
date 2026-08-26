/**
 * Series Romance Structure 2 — topology discovery and deterministic validation.
 *
 * Does not write research.seriesIdentity. Does not change retrieval, coverage,
 * or scoring. Model topology labels are hints; classifyRomanceTopology is
 * authoritative.
 */

import {
  ALTERNATIVE_LOVE_INTEREST,
  PAIRING_RELATIONS,
  emptySeriesRomanceIdentity,
  isPreservableRomanceIdentity,
  memberBySlot,
  normalizeRomancePairing,
  normalizeSeriesRomanceIdentity,
  primaryPairings,
  withRomanceObservability,
} from "./seriesRomanceIdentity.js";

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

export function mapRomanceEvidence(romance, { findings = [], sources = [] } = {}) {
  const normalized = normalizeSeriesRomanceIdentity(romance);
  const urlToId = new Map();
  for (const source of sources || []) {
    const url = asString(source.url).toLowerCase();
    if (url && source.id) urlToId.set(url, source.id);
  }
  const pairings = normalized.pairings.map((pairing) => {
    const urls = [...(pairing.evidenceUrls || [])];
    for (const index of pairing.evidenceFindingIndexes || []) {
      const finding = findings[index];
      if (finding?.url) urls.push(finding.url);
    }
    const mappedIds = unique(
      urls
        .map((url) => urlToId.get(asString(url).toLowerCase()))
        .filter(Boolean)
    );
    return {
      ...pairing,
      evidenceSourceIds: unique([
        ...(pairing.evidenceSourceIds || []),
        ...mappedIds,
      ]),
    };
  });
  return withRomanceObservability({
    ...normalized,
    pairings,
    resolution: romance.resolution || normalized.resolution,
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

export { primaryPairings };

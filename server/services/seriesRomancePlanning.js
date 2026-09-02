/**
 * Series Romance Structure 3.1 — pure scope scheduling for adaptive planner jobs.
 *
 * Metadata-only. Does not call models, mutate research, or affect retrieval.
 */

import { IDENTITY_RESOLUTION_VERSION } from "./versions.js";
import {
  ROMANCE_DISCOVERY_SOURCES,
  primaryPairings,
} from "./seriesRomanceIdentity.js";
import {
  pairingHasScope,
  pairingScopeKeys,
} from "./seriesRomanceDiscovery.js";

export const ROMANCE_SCOPE_ELIGIBLE_FIELDS = Object.freeze([
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Rhysand-faktoren",
  "Kvindelig udvikling (0-5)",
]);

const ELIGIBLE_FIELD_SET = new Set(ROMANCE_SCOPE_ELIGIBLE_FIELDS);

const READY_TOPOLOGIES = new Set(["rotating_couples", "ensemble_mixed"]);

function compareAscii(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortTargetFields(targetFields = []) {
  return [...(targetFields || [])]
    .map((field) => String(field || "").trim())
    .filter(Boolean)
    .sort(compareAscii);
}

function fieldsOverlap(left = [], right = []) {
  const current = new Set(sortTargetFields(right));
  if (!current.size) return false;
  return sortTargetFields(left).some((field) => current.has(field));
}

export function sortedDisplayMemberNames(members = []) {
  return (members || [])
    .map((member) => String(member?.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => compareAscii(a.toLowerCase(), b.toLowerCase()));
}

function hasApplicableMemberNames(pairing) {
  return sortedDisplayMemberNames(pairing?.members).length > 0;
}

export function isTargetFieldsRomanceScopeEligible(targetFields) {
  if (!Array.isArray(targetFields) || !targetFields.length) return false;
  return targetFields.every((field) => ELIGIBLE_FIELD_SET.has(field));
}

export function isRomanceScopePlanningReady(seriesRomanceIdentity) {
  if (!seriesRomanceIdentity || typeof seriesRomanceIdentity !== "object") {
    return false;
  }
  const discovery = seriesRomanceIdentity.discovery;
  const resolution = seriesRomanceIdentity.resolution;
  const topology = seriesRomanceIdentity.topology;

  if (discovery?.source !== ROMANCE_DISCOVERY_SOURCES.TOPOLOGY_DISCOVERY) {
    return false;
  }
  if (discovery?.attempted !== true) return false;
  if (discovery?.resolved !== true) return false;
  if (discovery?.version !== IDENTITY_RESOLUTION_VERSION) return false;
  if (resolution?.resolved !== true) return false;
  if (!READY_TOPOLOGIES.has(topology)) return false;

  return primaryPairings(seriesRomanceIdentity).some(
    (pairing) => pairingHasScope(pairing) && hasApplicableMemberNames(pairing)
  );
}

function minNumericBookNumber(pairing) {
  const numbers = (pairing?.bookScopes || [])
    .map((scope) => scope?.bookNumber)
    .filter((value) => value != null && Number.isFinite(value));
  return numbers.length ? Math.min(...numbers) : null;
}

function minArcScopeKey(pairing) {
  const arcKeys = pairingScopeKeys(pairing)
    .filter(
      (key) => key.startsWith("arc:") || key.startsWith("arcLabel:")
    )
    .sort(compareAscii);
  return arcKeys[0] || null;
}

function memberNamesSortKey(pairing) {
  return sortedDisplayMemberNames(pairing?.members)
    .map((name) => name.toLowerCase())
    .join("+");
}

export function pairingSelectionSortKey(pairing) {
  return {
    bookNumber: minNumericBookNumber(pairing),
    arcKey: minArcScopeKey(pairing),
    memberKey: memberNamesSortKey(pairing),
    idFallback: String(pairing?.id || ""),
  };
}

export function comparePairingSelection(a, b) {
  const left = pairingSelectionSortKey(a);
  const right = pairingSelectionSortKey(b);

  if (left.bookNumber == null && right.bookNumber == null) {
    // continue
  } else if (left.bookNumber == null) {
    return 1;
  } else if (right.bookNumber == null) {
    return -1;
  } else if (left.bookNumber !== right.bookNumber) {
    return left.bookNumber - right.bookNumber;
  }

  if (left.arcKey == null && right.arcKey == null) {
    // continue
  } else if (left.arcKey == null) {
    return 1;
  } else if (right.arcKey == null) {
    return -1;
  } else {
    const arcCmp = compareAscii(left.arcKey, right.arcKey);
    if (arcCmp !== 0) return arcCmp;
  }

  const memberCmp = compareAscii(left.memberKey, right.memberKey);
  if (memberCmp !== 0) return memberCmp;

  return compareAscii(left.idFallback, right.idFallback);
}

export function semanticPairingKey({ memberNames = [], bookScopes = [], arcScopes = [] } = {}) {
  const names = [...memberNames]
    .map((name) => String(name || "").trim().toLowerCase())
    .filter(Boolean)
    .sort(compareAscii);
  const scopeKeys = pairingScopeKeys({ bookScopes, arcScopes }).sort(compareAscii);
  return `${names.join("+")}|${scopeKeys.join("|")}`;
}

/**
 * Per-field attempted identity: strategy + canonical field + semanticPairingKey.
 * Whole-set exact matching is intentionally not used.
 */
export function fieldScopeAttemptKey({ strategy, field, romanceScope } = {}) {
  if (!strategy || !field || !romanceScope || typeof romanceScope !== "object") {
    return null;
  }
  const canonicalField = String(field).trim();
  if (!canonicalField) return null;
  const semantic = semanticPairingKey(romanceScope);
  if (!semantic || semantic === "|") return null;
  return `${strategy}\0${canonicalField}\0${semantic}`;
}

/** Deterministic fingerprint of all per-field attempt keys for a job field-set. */
export function scopeAttemptKey({ strategy, targetFields, romanceScope } = {}) {
  const keys = sortTargetFields(targetFields || [])
    .map((field) => fieldScopeAttemptKey({ strategy, field, romanceScope }))
    .filter(Boolean);
  return keys.length ? keys.join("\n") : null;
}

export function buildRomanceScope(pairing, topology) {
  return {
    pairingId: pairing.id,
    memberNames: sortedDisplayMemberNames(pairing.members),
    bookScopes: (pairing.bookScopes || []).map((scope) => ({ ...scope })),
    arcScopes: (pairing.arcScopes || []).map((scope) => ({ ...scope })),
    topology,
  };
}

export function defensiveCopyRomanceScope(scope) {
  if (scope == null) return null;
  if (typeof scope !== "object") return null;
  return {
    pairingId: scope.pairingId,
    memberNames: [...(scope.memberNames || [])],
    bookScopes: (scope.bookScopes || []).map((item) => ({ ...item })),
    arcScopes: (scope.arcScopes || []).map((item) => ({ ...item })),
    topology: scope.topology,
  };
}

/**
 * Project executed jobTrace history onto semantic pairing keys attempted for
 * the current strategy when at least one target field overlaps.
 *
 * History identity is per (strategy, field, semanticPairingKey).
 * Exact whole-set targetFields equality is intentionally not required.
 */
export function collectAttemptedSemanticKeys({
  previousRounds = [],
  strategy,
  targetFields = [],
} = {}) {
  const attempted = new Set();
  if (!strategy) return attempted;
  const currentFields = new Set(sortTargetFields(targetFields));
  if (!currentFields.size) return attempted;

  for (const round of previousRounds || []) {
    for (const job of round?.jobs || []) {
      if (!job || job.strategy !== strategy) continue;
      if (!job.romanceScope || typeof job.romanceScope !== "object") continue;
      try {
        const previousFields = job.targetFields || job.fields || [];
        if (!fieldsOverlap(previousFields, [...currentFields])) continue;
        const key = semanticPairingKey(job.romanceScope);
        if (key && key !== "|") attempted.add(key);
      } catch {
        // Ignore malformed trace metadata from older rounds.
      }
    }
  }

  return attempted;
}

function isSelectableCandidate(
  pairing,
  {
    seriesRomanceIdentity,
    attemptedSemanticKeys,
    plannedSemanticPairingKeys,
  }
) {
  if (!isRomanceScopePlanningReady(seriesRomanceIdentity)) return false;
  if (pairing?.prominence !== "primary") return false;
  if (!pairingHasScope(pairing)) return false;
  if (!hasApplicableMemberNames(pairing)) return false;

  const semanticKey = semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing.members),
    bookScopes: pairing.bookScopes,
    arcScopes: pairing.arcScopes,
  });
  if (!semanticKey || semanticKey === "|") return false;
  if (attemptedSemanticKeys.has(semanticKey)) return false;
  if (plannedSemanticPairingKeys.has(semanticKey)) return false;
  return true;
}

export function selectRomanceScopeForJob({
  seriesRomanceIdentity,
  strategy,
  targetFields = [],
  previousRounds = [],
  plannedSemanticPairingKeys = new Set(),
} = {}) {
  if (!isTargetFieldsRomanceScopeEligible(targetFields)) return null;
  if (!isRomanceScopePlanningReady(seriesRomanceIdentity)) return null;

  const attemptedSemanticKeys = collectAttemptedSemanticKeys({
    previousRounds,
    strategy,
    targetFields,
  });

  const candidates = primaryPairings(seriesRomanceIdentity)
    .filter((pairing) =>
      isSelectableCandidate(pairing, {
        seriesRomanceIdentity,
        attemptedSemanticKeys,
        plannedSemanticPairingKeys,
      })
    )
    .sort(comparePairingSelection);

  const chosen = candidates[0];
  if (!chosen) return null;

  if (
    !isSelectableCandidate(chosen, {
      seriesRomanceIdentity,
      attemptedSemanticKeys,
      plannedSemanticPairingKeys,
    })
  ) {
    return null;
  }

  return buildRomanceScope(chosen, seriesRomanceIdentity.topology);
}

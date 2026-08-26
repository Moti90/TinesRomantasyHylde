/**
 * Additive series-level romance identity (Series Romance Structure 1).
 *
 * Does not replace research.seriesIdentity. Does not infer rotating/ensemble
 * topology from live research — that stays a later bid. This module only
 * represents structure and projects a valid single_couple onto the legacy
 * MMC/FMC object.
 *
 * alternative_love_interest lives on a pairing's `alternatives`.
 * another_primary_pairing / secondary_pairing are pairing relations, not
 * renamed alternatives.
 */

export const ROMANCE_TOPOLOGIES = Object.freeze([
  "single_couple",
  "rotating_couples",
  "ensemble_mixed",
  "unknown",
]);

export const PAIRING_PROMINENCE = Object.freeze(["primary", "secondary"]);

export const PAIRING_RELATIONS = Object.freeze({
  ANOTHER_PRIMARY: "another_primary_pairing",
  SECONDARY: "secondary_pairing",
});

export const ALTERNATIVE_LOVE_INTEREST = "alternative_love_interest";

export const ROMANTIC_LEAD_ROLE = "romantic_lead";

const TOPOLOGY_SET = new Set(ROMANCE_TOPOLOGIES);
const PROMINENCE_SET = new Set(PAIRING_PROMINENCE);
const RELATION_SET = new Set(Object.values(PAIRING_RELATIONS));

function unique(arr) {
  return [...new Set((arr || []).filter((v) => v != null && v !== ""))];
}

function asString(value) {
  return String(value || "").trim();
}

function asConfidence(value) {
  return ["high", "medium", "low"].includes(value) ? value : "low";
}

export function emptySeriesRomanceIdentity(over = {}) {
  return {
    topology: "unknown",
    pairings: [],
    resolution: {
      resolved: false,
      coverage: "none",
      reason: over.reason || "unspecified",
    },
  };
}

function normalizeBookScope(raw) {
  if (!raw || typeof raw !== "object") return null;
  const parsed =
    raw.bookNumber == null || raw.bookNumber === ""
      ? null
      : Number(raw.bookNumber);
  const bookNumber = Number.isFinite(parsed) ? parsed : null;
  const title = asString(raw.title);
  if (bookNumber == null && !title) return null;
  return {
    bookNumber,
    title: title || null,
  };
}

function normalizeArcScope(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = asString(raw.id);
  const label = asString(raw.label || raw.name);
  if (!id && !label) return null;
  return { id: id || null, label: label || null };
}

function normalizeMember(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const name = asString(raw);
    return name
      ? { name, role: ROMANTIC_LEAD_ROLE, slot: null }
      : null;
  }
  const name = asString(raw.name);
  if (!name) return null;
  const slot = ["mmc", "fmc"].includes(raw.slot) ? raw.slot : null;
  return {
    name,
    role: ROMANTIC_LEAD_ROLE,
    slot,
  };
}

function normalizeAlternative(raw) {
  if (!raw) return null;
  const name = asString(typeof raw === "string" ? raw : raw.name);
  if (!name) return null;
  const incomingRole = asString(typeof raw === "string" ? "" : raw.role);
  const preservedOriginal = asString(
    typeof raw === "string" ? "" : raw.originalRole
  );
  const originalRole =
    preservedOriginal && preservedOriginal !== ALTERNATIVE_LOVE_INTEREST
      ? preservedOriginal
      : incomingRole && incomingRole !== ALTERNATIVE_LOVE_INTEREST
        ? incomingRole
        : null;
  return {
    name,
    role: ALTERNATIVE_LOVE_INTEREST,
    originalRole,
  };
}

function defaultRelation(prominence, relation) {
  if (RELATION_SET.has(relation)) return relation;
  if (prominence === "secondary") return PAIRING_RELATIONS.SECONDARY;
  return null;
}

function pairingIdFromMembers(members, index) {
  const key = members
    .map((m) => m.name.toLowerCase())
    .sort()
    .join("+");
  return key ? `pairing-${key}` : `pairing-${index + 1}`;
}

export function normalizeRomancePairing(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const members = (Array.isArray(raw.members) ? raw.members : [])
    .map(normalizeMember)
    .filter(Boolean);
  const bookScopes = (Array.isArray(raw.bookScopes) ? raw.bookScopes : [])
    .map(normalizeBookScope)
    .filter(Boolean);
  const arcScopes = (Array.isArray(raw.arcScopes) ? raw.arcScopes : [])
    .map(normalizeArcScope)
    .filter(Boolean);
  const prominence = PROMINENCE_SET.has(raw.prominence)
    ? raw.prominence
    : "primary";
  const relation = defaultRelation(prominence, raw.relation);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
    .map(normalizeAlternative)
    .filter(Boolean);
  const evidenceSourceIds = unique(
    Array.isArray(raw.evidenceSourceIds) ? raw.evidenceSourceIds : []
  );
  const basis = Array.isArray(raw.basis)
    ? raw.basis.map((b) => asString(b)).filter(Boolean)
    : [];
  const id = asString(raw.id) || pairingIdFromMembers(members, index);
  if (!members.length && !id) return null;
  return {
    id,
    members,
    bookScopes,
    arcScopes,
    prominence,
    relation,
    confidence: asConfidence(raw.confidence),
    basis,
    evidenceSourceIds,
    alternatives,
  };
}

function coverageOf(topology, pairings, resolved) {
  if (!pairings.length) return "none";
  if (topology === "single_couple" && resolved) return "single_couple";
  if (
    topology === "rotating_couples" ||
    topology === "ensemble_mixed"
  ) {
    return resolved ? "multi_pairing" : "partial";
  }
  return "partial";
}

/**
 * Normalize an explicit romance-identity payload.
 * Does not upgrade unknown → single_couple based on pairing count.
 */
export function normalizeSeriesRomanceIdentity(raw = {}) {
  const empty = emptySeriesRomanceIdentity();
  if (!raw || typeof raw !== "object") return empty;
  const topology = TOPOLOGY_SET.has(raw.topology) ? raw.topology : "unknown";
  const pairings = (Array.isArray(raw.pairings) ? raw.pairings : [])
    .map((p, i) => normalizeRomancePairing(p, i))
    .filter(Boolean);
  const incoming = raw.resolution && typeof raw.resolution === "object"
    ? raw.resolution
    : {};
  const resolved = incoming.resolved === true;
  return {
    topology,
    pairings,
    resolution: {
      resolved,
      coverage:
        incoming.coverage || coverageOf(topology, pairings, resolved),
      reason: asString(incoming.reason) || (resolved ? "provided" : "unspecified"),
    },
  };
}

function primaryPairings(romance) {
  return (romance?.pairings || []).filter((p) => p.prominence === "primary");
}

function memberBySlot(pairing, slot) {
  return (pairing?.members || []).find((m) => m.slot === slot) || null;
}

/**
 * Project existing research.seriesIdentity onto the additive model.
 * Unresolved or incomplete leads stay topology `unknown`.
 * Never infers rotating_couples / ensemble_mixed.
 */
export function seriesRomanceIdentityFromLegacy(seriesIdentity = {}) {
  const mmc = asString(seriesIdentity.mmc);
  const fmc = asString(seriesIdentity.fmc);
  const resolved = seriesIdentity.resolution?.resolved === true;
  const members = [];
  if (fmc) members.push({ name: fmc, role: ROMANTIC_LEAD_ROLE, slot: "fmc" });
  if (mmc) members.push({ name: mmc, role: ROMANTIC_LEAD_ROLE, slot: "mmc" });
  const alternatives = (seriesIdentity.alternatives || []).map((a) => ({
    name: a?.name,
    role: a?.role,
    originalRole: a?.originalRole,
  }));
  const pairings = members.length
    ? [
        normalizeRomancePairing({
          id: pairingIdFromMembers(members, 0),
          members,
          prominence: "primary",
          relation: null,
          confidence: seriesIdentity.confidence,
          basis: seriesIdentity.basis || [],
          evidenceSourceIds: seriesIdentity.evidenceSourceIds || [],
          alternatives,
        }),
      ]
    : [];
  const topology = resolved && mmc && fmc ? "single_couple" : "unknown";
  return normalizeSeriesRomanceIdentity({
    topology,
    pairings,
    resolution: {
      resolved,
      coverage: coverageOf(topology, pairings, resolved),
      reason:
        seriesIdentity.resolution?.reason ||
        (resolved && topology === "single_couple"
          ? "legacy_single_couple"
          : "legacy_unresolved"),
    },
  });
}

/**
 * Project a valid single_couple romance identity back to legacy seriesIdentity.
 * Rotating / ensemble / unknown / multiple primaries do not pick a winner.
 * Pairing array order must not change the result.
 */
export function legacySeriesIdentityFromRomance(
  romanceIdentity,
  fallback = null
) {
  const romance = normalizeSeriesRomanceIdentity(romanceIdentity);
  if (romance.topology !== "single_couple") return fallback;
  if (romance.resolution.resolved !== true) return fallback;
  const primaries = primaryPairings(romance);
  if (primaries.length !== 1) return fallback;
  const pairing = primaries[0];
  const mmc = memberBySlot(pairing, "mmc")?.name || "";
  const fmc = memberBySlot(pairing, "fmc")?.name || "";
  if (!mmc || !fmc) return fallback;
  const alternatives = (pairing.alternatives || []).map((a) => ({
    name: a.name,
    role: a.originalRole || a.role,
  }));
  return {
    mmc,
    fmc,
    confidence: pairing.confidence || "low",
    basis: [...(pairing.basis || [])],
    alternatives,
    resolution: {
      resolved: true,
      reason: romance.resolution.reason,
    },
  };
}

export function isAlternativeLoveInterest(entry) {
  const role = asString(entry?.role);
  return role === ALTERNATIVE_LOVE_INTEREST;
}

export function isAnotherPrimaryPairing(pairing) {
  return (
    pairing?.relation === PAIRING_RELATIONS.ANOTHER_PRIMARY &&
    pairing?.prominence === "primary"
  );
}

export function isSecondaryPairing(pairing) {
  return (
    pairing?.prominence === "secondary" ||
    pairing?.relation === PAIRING_RELATIONS.SECONDARY
  );
}

/**
 * Attach additive romance identity next to legacy seriesIdentity.
 * Does not mutate seriesIdentity.
 */
export function attachSeriesRomanceIdentity(research, seriesIdentity) {
  if (!research || typeof research !== "object") return research;
  research.seriesRomanceIdentity = seriesRomanceIdentityFromLegacy(
    seriesIdentity || research.seriesIdentity || {}
  );
  return research;
}

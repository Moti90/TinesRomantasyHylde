/**
 * Series Romance Structure 4 — pairing-aware subject binding for scoped retrieval.
 *
 * Pure helpers. No API calls. Does not mutate input objects.
 * Does not affect coverage, scoring, or research.sources.
 */

import { stableHash } from "./hash.js";
import {
  characterNameMentionedInText,
  namesReferToSamePerson,
} from "./sourceSubject.js";
import {
  isRomanceScopePlanningReady,
  semanticPairingKey,
  sortedDisplayMemberNames,
} from "./seriesRomancePlanning.js";
import {
  PAIRING_RELATIONS,
} from "./seriesRomanceIdentity.js";
import { pairingScopeKeys } from "./seriesRomanceDiscovery.js";
import {
  isExecutableRomanceScope,
  normalizeStoredRomanceScope,
  sortArcScopes,
  sortBookScopes,
  sanitizeMemberNames,
} from "./seriesRomanceRetrieval.js";
import {
  IDENTITY_RESOLUTION_VERSION,
  SUBJECT_BINDING_VERSION,
} from "./versions.js";

export { SUBJECT_BINDING_VERSION };

export const BINDING_STATUSES = Object.freeze([
  "resolved",
  "mixed",
  "ambiguous",
  "unresolved",
  "invalid_identity",
  "invalid_record",
]);

export const RELATIONSHIP_CONTEXT_CUES = Object.freeze([
  /\b(love interest|romantic partner|romantic pairing|romantic couple|romantic relationship)\b/i,
  /\bendgame(?:\s+couple)?\b/i,
  /\b(?:falls?|fell|falling)\s+in\s+love\b/i,
  /\b(?:central\s+)?romantic\s+(?:pairing|couple|relationship|partner|dynamic)\b/i,
  /\bromance\s+between\b/i,
]);

export const SERIES_GLOBAL_CUES = Object.freeze([
  /\b(across the series|throughout the series|series[- ]wide|whole series|entire series)\b/i,
  /\b(every book|each book|later books|series as a whole|overall series)\b/i,
  /\b(series romance structure|central romantic dynamic of the series)\b/i,
]);

const CLAUSE_SPLIT =
  /(?<=[.!?])\s+|\s*;\s+|\b(?:while|whereas|however)\b|,?\s+\bbut\b/i;

function compareAscii(a, b) {
  if (a === b) return 0;
  return String(a) < String(b) ? -1 : 1;
}

function uniqueSorted(arr) {
  return [...new Set((arr || []).filter(Boolean))].sort(compareAscii);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitClauses(text) {
  return String(text || "")
    .split(CLAUSE_SPLIT)
    .map((c) => c.trim())
    .filter(Boolean);
}

function sourceParts(record) {
  const source = record?.source || {};
  return {
    title: String(source.title || "").trim(),
    summary: String(source.summary || "").trim(),
  };
}

function sourceBlob(record) {
  const { title, summary } = sourceParts(record);
  return `${title} ${summary}`.trim();
}

function hasRelationshipContext(text) {
  const blob = String(text || "");
  return RELATIONSHIP_CONTEXT_CUES.some((re) => re.test(blob));
}

function hasSeriesGlobalSignal(text) {
  const blob = String(text || "");
  return SERIES_GLOBAL_CUES.some((re) => re.test(blob));
}

/**
 * Full normalized phrase match with word boundaries.
 * Does not use character-name token/given-name fallbacks.
 */
export function phraseMentionedInText(text, phrase) {
  const normalized = normalizeName(phrase);
  if (!normalized || normalized.length < 2) return false;
  const pattern = normalized
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(String(text || ""));
}

/**
 * Book numbers require explicit book-context language, not a bare digit.
 */
export function bookNumberMentionedInText(text, bookNumber) {
  const n = Number(bookNumber);
  if (!Number.isFinite(n)) return false;
  const re = new RegExp(
    `\\b(?:book|volume|novel|installment)\\s*#?\\s*${n}\\b|\\b#${n}\\b`,
    "i"
  );
  return re.test(String(text || ""));
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function nameLower(name) {
  return normalizeName(name).toLowerCase();
}

function memberSetKey(names = []) {
  return sanitizeMemberNames(names)
    .map((n) => n.toLowerCase())
    .sort(compareAscii)
    .join("+");
}

function pairingSemanticKey(pairing) {
  return semanticPairingKey({
    memberNames: sortedDisplayMemberNames(pairing?.members),
    bookScopes: pairing?.bookScopes || [],
    arcScopes: pairing?.arcScopes || [],
  });
}

function sortMembers(members = []) {
  return [...(members || [])]
    .map((m) => ({
      name: normalizeName(m?.name),
      slot: m?.slot === "mmc" || m?.slot === "fmc" ? m.slot : null,
    }))
    .filter((m) => m.name)
    .sort((a, b) => {
      const n = compareAscii(a.name.toLowerCase(), b.name.toLowerCase());
      if (n !== 0) return n;
      return compareAscii(a.slot || "", b.slot || "");
    });
}

function cloneBookScopes(scopes = []) {
  return sortBookScopes(scopes).map((b) => ({
    bookNumber: b.bookNumber ?? null,
    title: b.title || null,
  }));
}

function cloneArcScopes(scopes = []) {
  return sortArcScopes(scopes).map((a) => ({
    id: a.id || null,
    label: a.label || null,
  }));
}

function bookKey(book) {
  if (book?.bookNumber != null) return `book:${book.bookNumber}`;
  if (book?.title) return `title:${String(book.title).toLowerCase()}`;
  return "";
}

function arcKey(arc) {
  if (arc?.id) return `arc:${String(arc.id).toLowerCase()}`;
  if (arc?.label) return `arcLabel:${String(arc.label).toLowerCase()}`;
  return "";
}

/**
 * Deterministic fingerprint of binding-relevant identity data.
 */
export function buildIdentityFingerprint(seriesRomanceIdentity) {
  const romance = seriesRomanceIdentity || {};
  const discovery = romance.discovery || {};
  const pairings = (romance.pairings || []).map((pairing) => {
    const members = sortMembers(pairing.members).map((m) => ({
      nameLower: m.name.toLowerCase(),
      slot: m.slot,
    }));
    const alternatives = uniqueSorted(
      (pairing.alternatives || []).map((a) => nameLower(a?.name)).filter(Boolean)
    );
    return {
      semanticPairingKey: pairingSemanticKey(pairing),
      prominence: pairing.prominence || null,
      relation: pairing.relation || null,
      members,
      alternatives,
      bookScopes: pairingScopeKeys({
        bookScopes: pairing.bookScopes,
        arcScopes: [],
      }).sort(compareAscii),
      arcScopes: pairingScopeKeys({
        bookScopes: [],
        arcScopes: pairing.arcScopes,
      }).sort(compareAscii),
    };
  });
  pairings.sort((a, b) =>
    compareAscii(a.semanticPairingKey || "", b.semanticPairingKey || "")
  );

  return stableHash({
    bindingVersion: SUBJECT_BINDING_VERSION,
    identityVersion: IDENTITY_RESOLUTION_VERSION,
    discovery: {
      source: discovery.source || null,
      attempted: discovery.attempted === true,
      resolved: discovery.resolved === true,
      version: discovery.version || null,
    },
    resolutionResolved: romance.resolution?.resolved === true,
    topology: romance.topology || null,
    pairings,
  });
}

export function isStructurallyValidScopedRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (!record.id || typeof record.id !== "string") return false;
  if (!record.source || typeof record.source !== "object") return false;
  if (!record.source.url) return false;
  if (record.requestedRomanceScope == null) return false;
  if (typeof record.requestedRomanceScope !== "object") return false;
  if (!isExecutableRomanceScope(record.requestedRomanceScope)) return false;
  return true;
}

function emptyBinding(status, fingerprint) {
  return {
    version: SUBJECT_BINDING_VERSION,
    identityFingerprint: fingerprint || "",
    status,
    bindings: [],
  };
}

function mentioned(blob, name) {
  return characterNameMentionedInText(blob, name);
}

function findMentionedMembers(blob, pairing) {
  return sortMembers(pairing.members).filter((m) => mentioned(blob, m.name));
}

/**
 * Pairing threshold: all members + romantic cue must share one clause.
 * Exception: all names clearly established in title, and summary carries
 * explicit romantic context about them.
 */
function relationshipInSharedContext(title, summary, names) {
  if (!names?.length) return false;
  const titleText = String(title || "").trim();
  const summaryText = String(summary || "").trim();

  const clauses = [];
  if (titleText) clauses.push(titleText);
  for (const clause of splitClauses(summaryText)) clauses.push(clause);

  for (const clause of clauses) {
    if (
      names.every((n) => mentioned(clause, n)) &&
      hasRelationshipContext(clause)
    ) {
      return true;
    }
  }

  if (
    titleText &&
    names.every((n) => mentioned(titleText, n)) &&
    hasRelationshipContext(summaryText)
  ) {
    return true;
  }

  return false;
}

function buildBindingId({
  recordId,
  subjectType,
  relationshipRole,
  relationToRequest,
  semanticPairingKey: key,
  members,
  bookScopes,
  arcScopes,
}) {
  return `scoped-binding-${stableHash({
    recordId: recordId || "",
    subjectType: subjectType || "",
    relationshipRole: relationshipRole || "",
    relationToRequest: relationToRequest || "",
    semanticPairingKey: key || "",
    memberKey: memberSetKey((members || []).map((m) => m.name)),
    bookKey: (bookScopes || []).map(bookKey).filter(Boolean).sort(compareAscii).join("|"),
    arcKey: (arcScopes || []).map(arcKey).filter(Boolean).sort(compareAscii).join("|"),
  })}`;
}

function makeBinding(partial, recordId) {
  const members = sortMembers(partial.members || []);
  const bookScopes = cloneBookScopes(partial.bookScopes || []);
  const arcScopes = cloneArcScopes(partial.arcScopes || []);
  const signals = uniqueSorted(partial.signals || []);
  const reasons = uniqueSorted(partial.reasons || []);
  const binding = {
    subjectType: partial.subjectType,
    relationshipRole:
      partial.relationshipRole === undefined ? null : partial.relationshipRole,
    relationToRequest: partial.relationToRequest || "not_applicable",
    semanticPairingKey: partial.semanticPairingKey ?? null,
    pairingId: partial.pairingId ?? null,
    members,
    bookScopes,
    arcScopes,
    confidence: partial.confidence || "medium",
    signals,
    reasons,
  };
  binding.id = buildBindingId({
    recordId,
    ...binding,
  });
  return binding;
}

function resolveRequestedPairing(requestedScope, romance) {
  const normalized = normalizeStoredRomanceScope(requestedScope);
  if (!normalized) {
    return { kind: "malformed" };
  }
  const requestedKey = semanticPairingKey(normalized);
  const pairings = romance.pairings || [];

  const byKey = pairings.filter((p) => pairingSemanticKey(p) === requestedKey);
  if (byKey.length === 1) {
    return { kind: "matched", pairing: byKey[0], semanticPairingKey: requestedKey };
  }
  if (byKey.length > 1) {
    return { kind: "ambiguous" };
  }

  const memberKey = memberSetKey(normalized.memberNames);
  if (!memberKey) return { kind: "unmatched" };

  const byMembers = pairings.filter(
    (p) => memberSetKey(sortedDisplayMemberNames(p.members)) === memberKey
  );
  if (byMembers.length === 1) {
    return {
      kind: "matched",
      pairing: byMembers[0],
      semanticPairingKey: pairingSemanticKey(byMembers[0]),
    };
  }
  if (byMembers.length > 1) {
    return { kind: "ambiguous" };
  }
  return { kind: "unmatched" };
}

function relationshipRoleForPairing(pairing, requestedMatch) {
  if (
    requestedMatch.kind === "matched" &&
    pairingSemanticKey(pairing) === requestedMatch.semanticPairingKey
  ) {
    return "requested_pairing";
  }
  if (
    pairing.prominence === "secondary" ||
    pairing.relation === PAIRING_RELATIONS.SECONDARY
  ) {
    return "secondary_pairing";
  }
  if (pairing.prominence === "primary") {
    return "another_primary_pairing";
  }
  return null;
}

function relationToRequestForRole(role, requestedMatch) {
  if (requestedMatch.kind !== "matched") return "not_applicable";
  if (role === "requested_pairing") return "matches_request";
  if (
    role === "another_primary_pairing" ||
    role === "secondary_pairing" ||
    role === "alternative_love_interest"
  ) {
    return "different_scope";
  }
  return "not_applicable";
}

function detectBookBindings(blob, romance, recordId) {
  const out = [];
  const seen = new Set();
  for (const pairing of romance.pairings || []) {
    for (const book of pairing.bookScopes || []) {
      const key = bookKey(book);
      if (!key || seen.has(key)) continue;
      let hit = false;
      const signals = [];
      if (book.title && phraseMentionedInText(blob, book.title)) {
        hit = true;
        signals.push("explicit_book_title");
      }
      if (
        book.bookNumber != null &&
        bookNumberMentionedInText(blob, book.bookNumber)
      ) {
        hit = true;
        signals.push("explicit_book_number");
      }
      if (!hit) continue;
      seen.add(key);
      out.push(
        makeBinding(
          {
            subjectType: "book",
            relationshipRole: null,
            relationToRequest: "not_applicable",
            semanticPairingKey: null,
            pairingId: null,
            members: [],
            bookScopes: [book],
            arcScopes: [],
            confidence: "high",
            signals,
            reasons: ["explicit_book_evidence"],
          },
          recordId
        )
      );
    }
  }
  return out;
}

function detectArcBindings(blob, romance, recordId) {
  const out = [];
  const seen = new Set();
  for (const pairing of romance.pairings || []) {
    for (const arc of pairing.arcScopes || []) {
      const key = arcKey(arc);
      if (!key || seen.has(key)) continue;
      // Opaque IDs are not positive text evidence — require recognizable label phrase.
      if (!arc.label || !phraseMentionedInText(blob, arc.label)) continue;
      seen.add(key);
      out.push(
        makeBinding(
          {
            subjectType: "arc",
            relationshipRole: null,
            relationToRequest: "not_applicable",
            semanticPairingKey: null,
            pairingId: null,
            members: [],
            bookScopes: [],
            arcScopes: [arc],
            confidence: "high",
            signals: ["explicit_arc_label"],
            reasons: ["explicit_arc_evidence"],
          },
          recordId
        )
      );
    }
  }
  return out;
}

function detectPairingAndMemberBindings(title, summary, romance, requestedMatch, recordId) {
  const bindings = [];
  let ambiguousSubject = false;
  const blob = `${title || ""} ${summary || ""}`.trim();

  for (const pairing of romance.pairings || []) {
    const members = sortMembers(pairing.members);
    const mentionedMembers = findMentionedMembers(blob, pairing);
    if (!mentionedMembers.length) continue;

    const key = pairingSemanticKey(pairing);
    const role = relationshipRoleForPairing(pairing, requestedMatch);
    const baseRelation = relationToRequestForRole(role, requestedMatch);

    if (members.length === 1) {
      bindings.push(
        makeBinding(
          {
            subjectType: "member",
            relationshipRole: role,
            relationToRequest:
              role === "requested_pairing" ? "partial_match" : baseRelation,
            semanticPairingKey: key,
            pairingId: pairing.id || null,
            members: mentionedMembers,
            confidence: "high",
            signals: ["explicit_member_name"],
            reasons: ["one_member_pairing_entry"],
          },
          recordId
        )
      );
      continue;
    }

    const allMentioned =
      members.length > 0 &&
      members.every((m) =>
        mentionedMembers.some((x) => namesReferToSamePerson(x.name, m.name))
      );

    if (
      allMentioned &&
      relationshipInSharedContext(
        title,
        summary,
        members.map((m) => m.name)
      )
    ) {
      bindings.push(
        makeBinding(
          {
            subjectType: "pairing",
            relationshipRole: role,
            relationToRequest: baseRelation,
            semanticPairingKey: key,
            pairingId: pairing.id || null,
            members,
            confidence: "high",
            signals: ["explicit_all_members", "relationship_context"],
            reasons: ["full_pairing_threshold"],
          },
          recordId
        )
      );
      continue;
    }

    for (const member of mentionedMembers) {
      bindings.push(
        makeBinding(
          {
            subjectType: "member",
            relationshipRole: role,
            relationToRequest:
              role === "requested_pairing" ? "partial_match" : baseRelation,
            semanticPairingKey: key,
            pairingId: pairing.id || null,
            members: [member],
            confidence: "high",
            signals: ["explicit_member_name"],
            reasons: allMentioned
              ? ["members_without_relationship_context"]
              : ["partial_member_mention"],
          },
          recordId
        )
      );
    }
  }

  const suppressed = suppressCrossPairSharedMembers(bindings);

  // Alternative love interests
  for (const pairing of romance.pairings || []) {
    const parentKey = pairingSemanticKey(pairing);
    for (const alt of pairing.alternatives || []) {
      const name = normalizeName(alt?.name);
      if (!name || !mentioned(blob, name)) continue;

      const leadHits = (romance.pairings || []).filter((p) =>
        (p.members || []).some((m) => namesReferToSamePerson(m.name, name))
      );
      if (leadHits.length > 0) {
        ambiguousSubject = true;
        continue;
      }

      const parentRole = relationshipRoleForPairing(pairing, requestedMatch);
      let relation = "not_applicable";
      if (requestedMatch.kind === "matched") {
        if (parentRole === "requested_pairing") {
          const hasRequestedPairingContext = suppressed.some(
            (b) =>
              b.subjectType === "pairing" &&
              b.relationshipRole === "requested_pairing"
          );
          relation = hasRequestedPairingContext
            ? "partial_match"
            : "different_scope";
        } else {
          relation = "different_scope";
        }
      }

      suppressed.push(
        makeBinding(
          {
            subjectType: "member",
            relationshipRole: "alternative_love_interest",
            relationToRequest: relation,
            semanticPairingKey: parentKey,
            pairingId: pairing.id || null,
            members: [{ name, slot: null }],
            confidence: "high",
            signals: ["explicit_alternative_name"],
            reasons: ["alternative_love_interest"],
          },
          recordId
        )
      );
    }
  }

  return { bindings: suppressed, ambiguousSubject };
}

/**
 * When a full pairing is identified, drop cross-pair member candidates that
 * only reflect a shared name already covered by that pairing.
 */
function suppressCrossPairSharedMembers(bindings = []) {
  const pairingBinds = bindings.filter((b) => b.subjectType === "pairing");
  if (!pairingBinds.length) return [...bindings];

  const coveredNames = new Set();
  for (const b of pairingBinds) {
    for (const m of b.members || []) coveredNames.add(nameLower(m.name));
  }
  const pairingKeys = new Set(
    pairingBinds.map((b) => b.semanticPairingKey).filter(Boolean)
  );

  return bindings.filter((b) => {
    if (b.subjectType !== "member") return true;
    if (b.relationshipRole === "alternative_love_interest") return true;
    if (pairingKeys.has(b.semanticPairingKey)) return true;
    const names = (b.members || []).map((m) => nameLower(m.name));
    if (!names.length) return true;
    // Shared-name spillover only: every mentioned member already covered by
    // an identified full pairing, with no unique other-pairing support.
    if (names.every((n) => coveredNames.has(n))) return false;
    return true;
  });
}

function detectSeriesGlobal(blob, recordId) {
  if (!hasSeriesGlobalSignal(blob)) return [];
  return [
    makeBinding(
      {
        subjectType: "series_global",
        relationshipRole: null,
        relationToRequest: "not_applicable",
        semanticPairingKey: null,
        pairingId: null,
        members: [],
        confidence: "medium",
        signals: ["explicit_series_global_language"],
        reasons: ["series_wide_context"],
      },
      recordId
    ),
  ];
}

/**
 * When exactly one romantic subject is identified and a book/arc scope belongs
 * to that subject's pairing, attach pairing identity onto the orthogonal binding.
 */
function linkOrthogonalSubjectContext(bindings, romance, requestedMatch, recordId) {
  const romanticSubjects = collectRomanticSubjects(bindings);
  if (romanticSubjects.size !== 1) return bindings;

  const romanticBindings = bindings.filter(
    (b) =>
      b.subjectType === "pairing" ||
      b.subjectType === "member" ||
      b.relationshipRole === "alternative_love_interest"
  );
  const ownerKey =
    romanticBindings.find((b) => b.subjectType === "pairing")?.semanticPairingKey ||
    romanticBindings.find((b) => b.semanticPairingKey)?.semanticPairingKey ||
    null;
  if (!ownerKey) return bindings;

  const ownerPairing = (romance.pairings || []).find(
    (p) => pairingSemanticKey(p) === ownerKey
  );
  if (!ownerPairing) return bindings;

  const role = relationshipRoleForPairing(ownerPairing, requestedMatch);
  const relation = relationToRequestForRole(role, requestedMatch);
  const ownerBookKeys = new Set(
    (ownerPairing.bookScopes || []).map(bookKey).filter(Boolean)
  );
  const ownerArcKeys = new Set(
    (ownerPairing.arcScopes || []).map(arcKey).filter(Boolean)
  );

  return bindings.map((b) => {
    if (b.subjectType !== "book" && b.subjectType !== "arc") return b;
    let belongs = false;
    if (b.subjectType === "book") {
      belongs = (b.bookScopes || []).some((bs) => ownerBookKeys.has(bookKey(bs)));
    } else {
      belongs = (b.arcScopes || []).some((as) => ownerArcKeys.has(arcKey(as)));
    }
    if (!belongs) return b;
    return makeBinding(
      {
        subjectType: b.subjectType,
        relationshipRole: role,
        relationToRequest: relation,
        semanticPairingKey: ownerKey,
        pairingId: ownerPairing.id || null,
        members: [],
        bookScopes: b.bookScopes,
        arcScopes: b.arcScopes,
        confidence: b.confidence,
        signals: b.signals,
        reasons: uniqueSorted([
          ...(b.reasons || []),
          "orthogonal_subject_context",
        ]),
      },
      recordId
    );
  });
}

/**
 * Compaction: pairing subsumes same-pairing members; ALT LI never subsumed;
 * book/arc/series_global orthogonal; drop exact duplicates.
 */
export function compactBindings(bindings = []) {
  let list = [...(bindings || [])];

  const pairingKeys = new Set(
    list
      .filter((b) => b.subjectType === "pairing" && b.semanticPairingKey)
      .map((b) => b.semanticPairingKey)
  );

  list = list.filter((b) => {
    if (b.subjectType !== "member") return true;
    if (b.relationshipRole === "alternative_love_interest") return true;
    if (!b.semanticPairingKey || !pairingKeys.has(b.semanticPairingKey)) {
      return true;
    }
    // Subsume member of the same pairing.
    return false;
  });

  const byId = new Map();
  for (const b of list) {
    if (!byId.has(b.id)) byId.set(b.id, b);
  }
  return [...byId.values()].sort((a, b) => {
    const keys = [
      "subjectType",
      "relationshipRole",
      "relationToRequest",
      "semanticPairingKey",
      "id",
    ];
    for (const k of keys) {
      const cmp = compareAscii(String(a[k] ?? ""), String(b[k] ?? ""));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function collectRomanticSubjects(bindings) {
  const subjects = new Set();
  for (const b of bindings) {
    if (b.subjectType === "book" || b.subjectType === "arc") continue;
    if (b.subjectType === "series_global") continue;
    if (b.subjectType === "pairing") {
      subjects.add(`pairing:${b.semanticPairingKey}`);
      continue;
    }
    if (b.relationshipRole === "alternative_love_interest") {
      subjects.add(
        `altli:${b.semanticPairingKey}|${memberSetKey(
          (b.members || []).map((m) => m.name)
        )}`
      );
      continue;
    }
    if (b.subjectType === "member") {
      // Same pairing members collapse to one romantic subject family.
      subjects.add(`pairing-family:${b.semanticPairingKey || memberSetKey((b.members || []).map((m) => m.name))}`);
    }
  }
  return subjects;
}

function decideOverallStatus({
  bindings,
  ambiguousSubject,
  ready,
  validRecord,
}) {
  if (!validRecord) return "invalid_record";
  if (!ready) return "invalid_identity";
  if (ambiguousSubject) return "ambiguous";
  if (!bindings.length) return "unresolved";

  const romantic = collectRomanticSubjects(bindings);
  if (romantic.size >= 2) return "mixed";

  // series_global alone → resolved
  if (romantic.size === 0) {
    const onlyOrtho = bindings.every((b) =>
      ["book", "arc", "series_global"].includes(b.subjectType)
    );
    if (onlyOrtho && bindings.some((b) => b.subjectType === "series_global")) {
      return "resolved";
    }
    if (onlyOrtho && bindings.length) {
      // book/arc alone without romantic subject → unresolved romantic ownership
      return "unresolved";
    }
  }

  return "resolved";
}

/**
 * Bind one scoped retrieval record. Returns a new subjectBinding object.
 */
export function buildSubjectBinding(record, seriesRomanceIdentity) {
  const fingerprint = buildIdentityFingerprint(seriesRomanceIdentity);

  if (!isStructurallyValidScopedRecord(record)) {
    return emptyBinding("invalid_record", fingerprint);
  }

  if (!isRomanceScopePlanningReady(seriesRomanceIdentity)) {
    return emptyBinding("invalid_identity", fingerprint);
  }

  const requestedMatch = resolveRequestedPairing(
    record.requestedRomanceScope,
    seriesRomanceIdentity
  );

  const { title, summary } = sourceParts(record);
  const blob = `${title} ${summary}`.trim();
  if (!blob) {
    return emptyBinding("unresolved", fingerprint);
  }

  const detected = detectPairingAndMemberBindings(
    title,
    summary,
    seriesRomanceIdentity,
    requestedMatch,
    record.id
  );
  const books = detectBookBindings(blob, seriesRomanceIdentity, record.id);
  const arcs = detectArcBindings(blob, seriesRomanceIdentity, record.id);
  const seriesGlobal = detectSeriesGlobal(blob, record.id);

  let combined = [
    ...detected.bindings,
    ...books,
    ...arcs,
    ...seriesGlobal,
  ];
  combined = linkOrthogonalSubjectContext(
    combined,
    seriesRomanceIdentity,
    requestedMatch,
    record.id
  );

  // Name ambiguity: shared name across pairings without a disambiguating full pairing.
  let ambiguousSubject = detected.ambiguousSubject;
  const nameToPairings = new Map();
  for (const pairing of seriesRomanceIdentity.pairings || []) {
    for (const m of pairing.members || []) {
      if (!mentioned(blob, m.name)) continue;
      const key = nameLower(m.name);
      const list = nameToPairings.get(key) || [];
      list.push(pairingSemanticKey(pairing));
      nameToPairings.set(key, list);
    }
  }
  for (const [, keys] of nameToPairings) {
    if (new Set(keys).size > 1) {
      const uniqueKeys = [...new Set(keys)];
      const hasPairingBind = combined.some(
        (b) =>
          b.subjectType === "pairing" && uniqueKeys.includes(b.semanticPairingKey)
      );
      if (!hasPairingBind) ambiguousSubject = true;
    }
  }

  const compacted = compactBindings(combined);

  const status = decideOverallStatus({
    bindings: compacted,
    ambiguousSubject,
    ready: true,
    validRecord: true,
  });

  return {
    version: SUBJECT_BINDING_VERSION,
    identityFingerprint: fingerprint,
    status,
    bindings: status === "ambiguous" && ambiguousSubject && !compacted.length
      ? []
      : compacted,
  };
}

/**
 * Attach/replace subjectBinding on a record (defensive copy of record).
 */
export function bindScopedRetrievalRecord(record, seriesRomanceIdentity) {
  const copy = {
    ...record,
    source: record?.source ? { ...record.source } : record?.source,
    requestedRomanceScope: record?.requestedRomanceScope
      ? { ...record.requestedRomanceScope }
      : record?.requestedRomanceScope,
  };
  copy.subjectBinding = buildSubjectBinding(record, seriesRomanceIdentity);
  return copy;
}

function bindingIsFresh(binding, fingerprint) {
  if (!binding || typeof binding !== "object") return false;
  if (binding.version !== SUBJECT_BINDING_VERSION) return false;
  if (binding.identityFingerprint !== fingerprint) return false;
  return true;
}

function cloneBindingDeep(binding) {
  if (!binding || typeof binding !== "object") return binding;
  return {
    ...binding,
    members: (binding.members || []).map((m) => ({ ...m })),
    bookScopes: (binding.bookScopes || []).map((b) => ({ ...b })),
    arcScopes: (binding.arcScopes || []).map((a) => ({ ...a })),
    signals: [...(binding.signals || [])],
    reasons: [...(binding.reasons || [])],
  };
}

/**
 * Unique semanticPairingKey → current pairing.id.
 * Ambiguous/duplicate keys are omitted (must not guess).
 */
function uniquePairingIdBySemanticKey(romance) {
  const counts = new Map();
  for (const pairing of romance?.pairings || []) {
    const key = pairingSemanticKey(pairing);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const byKey = new Map();
  for (const pairing of romance?.pairings || []) {
    const key = pairingSemanticKey(pairing);
    if (!key || counts.get(key) !== 1) continue;
    byKey.set(key, pairing.id || null);
  }
  return byKey;
}

/**
 * Refresh non-null pairingId references that no longer match the unique
 * current identity pairing for the same semanticPairingKey.
 * Preserves binding.id and semanticPairingKey (pairingId is not part of id hash).
 */
function refreshStalePairingIdReferences(subjectBinding, romance) {
  const byKey = uniquePairingIdBySemanticKey(romance);
  const bindings = (subjectBinding?.bindings || []).map(cloneBindingDeep);
  for (const binding of bindings) {
    if (!binding.semanticPairingKey) continue;
    if (binding.pairingId == null) continue;
    if (!byKey.has(binding.semanticPairingKey)) continue;
    const currentId = byKey.get(binding.semanticPairingKey);
    if (binding.pairingId !== currentId) {
      binding.pairingId = currentId;
    }
  }
  return {
    ...subjectBinding,
    bindings,
  };
}

/**
 * Ensure all sidecar records have fresh bindings. Pure: returns new sidecar.
 */
export function ensureScopedSubjectBindings(scopedRetrieval, seriesRomanceIdentity) {
  const records = Array.isArray(scopedRetrieval?.records)
    ? scopedRetrieval.records
    : [];
  const fingerprint = buildIdentityFingerprint(seriesRomanceIdentity);
  const next = records.map((record) => {
    if (bindingIsFresh(record?.subjectBinding, fingerprint)) {
      const refreshed = refreshStalePairingIdReferences(
        record.subjectBinding,
        seriesRomanceIdentity
      );
      return {
        ...record,
        source: record?.source ? { ...record.source } : record?.source,
        subjectBinding: refreshed,
      };
    }
    return bindScopedRetrievalRecord(record, seriesRomanceIdentity);
  });
  return { records: next };
}

/**
 * Apply bindings onto research.scopedRetrieval (returns new research shallow copy).
 */
export function applyScopedSubjectBindings(research) {
  const scoped = research?.scopedRetrieval || { records: [] };
  const nextScoped = ensureScopedSubjectBindings(
    scoped,
    research?.seriesRomanceIdentity
  );
  return {
    ...research,
    scopedRetrieval: nextScoped,
  };
}

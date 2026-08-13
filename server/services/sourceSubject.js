/**
 * Deterministic source-subject binding (Bid 3 Fase B.1.3).
 *
 * Answers "who is this source about?" before field relevance
 * is allowed to count as evidence for a Tine field.
 *
 * No series-specific names. No AI calls.
 */

export const SUBJECT_STATUSES = [
  "target",
  "target_fmc",
  "alternative",
  "mixed",
  "ambiguous",
  "unknown",
];

export const FIELD_MATCH_TARGET_MMC = "FIELD_MATCH_TARGET_MMC";
export const FIELD_MATCH_TARGET_FMC = "FIELD_MATCH_TARGET_FMC";
export const FIELD_MATCH_TARGET_PAIRING = "FIELD_MATCH_TARGET_PAIRING";
export const FIELD_MATCH_WRONG_SUBJECT = "FIELD_MATCH_WRONG_SUBJECT";
export const FIELD_MATCH_AMBIGUOUS_SUBJECT = "FIELD_MATCH_AMBIGUOUS_SUBJECT";
export const FIELD_MATCH_ALTERNATIVE_CHARACTER = "FIELD_MATCH_ALTERNATIVE_CHARACTER";

export const MMC_BOUND_FIELDS = new Set([
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Rhysand-faktoren",
]);

export const FMC_BOUND_FIELDS = new Set(["Kvindelig udvikling (0-5)"]);

export const RELATIONSHIP_BOUND_FIELDS = new Set([
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "Romance i fokus (0-100%)",
]);

const HEROINE_CUES =
  /\b(heroine|female lead|\bfmc\b|heltinden|the girl|the woman)\b/i;
const MMC_GENERIC_CUES =
  /\b(mmc|male lead|the hero|mandlige (?:hovedperson|lead)|romantiske lead)\b/i;
const RELATION_CUES =
  /\b(love interest|partner|pairing|couple|endgame|romance|mate)\b/i;
const PRONOUN_CUES = /\b(he|she|him|his|her|they|them|himself|herself)\b/i;

const CLAUSE_SPLIT =
  /(?<=[.!?])\s+|\s*;\s+|\b(?:while|whereas|however)\b|,?\s+\bbut\b/i;

const MIN_GIVEN_NAME_FALLBACK = 4;

export function characterNameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-zæøåäöü]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function normalizeCharacterIdentityName(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  const tokens = characterNameTokens(raw);
  return {
    display: raw,
    normalized: tokens.join(" "),
    tokens,
    given: tokens[0] || "",
  };
}

/**
 * Conservative identity match.
 * "Feyre" ↔ "Feyre Archeron" / "Feyre Cursebreaker".
 * "Ann"  ped "Anna" do not match (single-token inequality, no prefixes).
 */
export function namesReferToSamePerson(a, b) {
  const ta = characterNameTokens(a);
  const tb = characterNameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length === 1 && longer.length === 1) {
    return shorter[0] === longer[0];
  }
  return shorter.every((t) => longer.includes(t));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWord(text, token) {
  if (!token || token.length < 2) return false;
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(String(text || ""));
}

/**
 * True when `name` (or a conservative shorter form) appears in text.
 * "Feyre Archeron" matches text that only contains "Feyre".
 * "Ann" does not match "Anna".
 */
export function characterNameMentionedInText(text, name) {
  const blob = String(text || "");
  const info = normalizeCharacterIdentityName(name);
  if (!info.tokens.length || blob.length < 2) return false;
  if (wholeWord(blob, info.display)) return true;
  if (info.tokens.length === 1) return wholeWord(blob, info.tokens[0]);
  if (info.tokens.every((t) => wholeWord(blob, t))) return true;
  if (info.given.length >= MIN_GIVEN_NAME_FALLBACK && wholeWord(blob, info.given)) {
    return true;
  }
  return false;
}

export function subjectIdentityFrom(research = {}, identity = {}, extra = {}) {
  const leads = extra.leadCharacters || research?.seriesIdentity || {};
  const hint = research?.identityHint || research?.structuredPairing || {};
  const mmc = String(
    extra.mmc || leads.mmc || identity?.mmc || hint.mmc || ""
  ).trim();
  const fmc = String(
    extra.fmc || leads.fmc || identity?.fmc || hint.fmc || ""
  ).trim();
  const alternatives = extra.alternatives || leads.alternatives || hint.alternatives || [];
  return {
    mmc,
    fmc,
    alternatives: Array.isArray(alternatives) ? alternatives : [],
  };
}

export function hasSubjectIdentity(identity) {
  return Boolean(identity?.mmc || identity?.fmc);
}

export function fieldSubjectRequirement(field) {
  if (MMC_BOUND_FIELDS.has(field)) return "mmc";
  if (FMC_BOUND_FIELDS.has(field)) return "fmc";
  if (field === "Karakterudvikling (0-5)") return "fmc_or_general";
  if (RELATIONSHIP_BOUND_FIELDS.has(field)) return "pairing";
  return "none";
}

function sourceSubjectBlob(source) {
  return `${source?.title || ""} ${source?.summary || ""} ${source?.snippet || ""}`;
}

function mentionedIn(blob, name) {
  return characterNameMentionedInText(blob, name);
}

function alternativeEntries(identity) {
  const mmc = identity?.mmc || "";
  const fmc = identity?.fmc || "";
  const out = [];
  for (const alt of identity?.alternatives || []) {
    const name = String(alt?.name || alt || "").trim();
    if (!name) continue;
    if (mmc && namesReferToSamePerson(name, mmc)) continue;
    if (fmc && namesReferToSamePerson(name, fmc)) continue;
    out.push({
      name,
      role: alt?.role || "alternative",
    });
  }
  return out;
}

function uniqueNames(names) {
  const out = [];
  for (const n of names || []) {
    if (!n) continue;
    if (out.some((x) => namesReferToSamePerson(x, n))) continue;
    out.push(n);
  }
  return out;
}

export function splitSubjectClauses(text) {
  const blob = String(text || "").trim();
  if (!blob) return [];
  return blob
    .split(CLAUSE_SPLIT)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function targetSubjectClauses(source, identity) {
  const blob = sourceSubjectBlob(source);
  const clauses = splitSubjectClauses(blob);
  const mmc = identity?.mmc || "";
  const alts = alternativeEntries(identity);
  if (!mmc || clauses.length <= 1) {
    return {
      separated: false,
      targetBlob: blob,
      alternativeBlob: "",
      clauses,
    };
  }
  const target = [];
  const alternative = [];
  const mixed = [];
  for (const clause of clauses) {
    const hasTarget = mentionedIn(clause, mmc);
    const hasAlt = alts.some((a) => mentionedIn(clause, a.name));
    if (hasTarget && hasAlt) mixed.push(clause);
    else if (hasTarget) target.push(clause);
    else if (hasAlt) alternative.push(clause);
    else target.push(clause);
  }
  const separated = target.length > 0 && mixed.length === 0 && alternative.length > 0;
  return {
    separated,
    targetBlob: (separated ? target : clauses).join(" "),
    alternativeBlob: alternative.join(" "),
    clauses,
    mixedClauses: mixed,
  };
}

function titleEstablishesName(source, name) {
  return mentionedIn(String(source?.title || ""), name);
}

function pronounOrRelationOnly(blob) {
  return PRONOUN_CUES.test(blob) || RELATION_CUES.test(blob) || MMC_GENERIC_CUES.test(blob);
}

export function evaluateSourceSubject(source, identity = {}, options = {}) {
  const mmc = String(identity?.mmc || "").trim();
  const fmc = String(identity?.fmc || "").trim();
  const alts = alternativeEntries(identity);
  const title = String(source?.title || "");
  const summary = `${source?.summary || ""} ${source?.snippet || ""}`;
  const blob = `${title} ${summary}`.trim();
  const basis = [];

  const targetMmcMentioned = Boolean(mmc && mentionedIn(blob, mmc));
  const targetFmcMentioned = Boolean(fmc && mentionedIn(blob, fmc));
  const alternativeMentions = alts.filter((a) => mentionedIn(blob, a.name));
  const alternativeMentioned = alternativeMentions.length > 0;

  if (targetMmcMentioned) basis.push("explicit_target_name");
  if (targetFmcMentioned) basis.push("pairing_context");
  if (alternativeMentioned) basis.push("alternative_name");

  const titleTarget = Boolean(mmc && titleEstablishesName(source, mmc));
  const titleFmc = Boolean(fmc && titleEstablishesName(source, fmc));
  if ((titleTarget || titleFmc) && PRONOUN_CUES.test(summary)) {
    basis.push("pronoun_context");
  }

  let subjectStatus = "unknown";
  let confidence = "low";

  if (targetMmcMentioned && alternativeMentioned) {
    subjectStatus = "mixed";
    confidence = "high";
  } else if (alternativeMentioned && !targetMmcMentioned) {
    subjectStatus = "alternative";
    confidence = "high";
  } else if (targetMmcMentioned) {
    subjectStatus = "target";
    confidence = "high";
  } else if (titleTarget && pronounOrRelationOnly(summary || blob)) {
    subjectStatus = "target";
    confidence = "medium";
    if (!basis.includes("pronoun_context")) basis.push("pronoun_context");
  } else if (targetFmcMentioned || (HEROINE_CUES.test(blob) && !alternativeMentioned && !targetMmcMentioned)) {
    subjectStatus = "target_fmc";
    confidence = targetFmcMentioned ? "high" : "medium";
  } else if (pronounOrRelationOnly(blob) || MMC_GENERIC_CUES.test(blob)) {
    subjectStatus = "ambiguous";
    confidence = "low";
    basis.push("pronoun_context");
  } else {
    subjectStatus = "unknown";
    confidence = "low";
  }

  if (options.urlSupport && source?.url && mmc && !targetMmcMentioned) {
    if (mentionedIn(decodeURIComponent(String(source.url)), mmc)) {
      basis.push("url_supporting");
    }
  }

  const mentionedCharacters = uniqueNames([
    targetMmcMentioned ? mmc : null,
    targetFmcMentioned ? fmc : null,
    ...alternativeMentions.map((a) => a.name),
  ]);

  return {
    subjectStatus,
    targetMmcMentioned: targetMmcMentioned || (subjectStatus === "target" && titleTarget),
    targetFmcMentioned,
    alternativeMentioned,
    alternativeMentions,
    mentionedCharacters,
    confidence,
    basis,
    targetMmc: mmc || "",
    targetFmc: fmc || "",
  };
}

export function buildSubjectHints(subject) {
  return {
    mentionedCharacters: subject?.mentionedCharacters || [],
    targetMmcMentioned: Boolean(subject?.targetMmcMentioned),
    targetFmcMentioned: Boolean(subject?.targetFmcMentioned),
    alternativeMentioned: Boolean(subject?.alternativeMentioned),
    subjectStatus: subject?.subjectStatus || "unknown",
  };
}

function rejectEval(fieldEvidence, reason, extra = {}) {
  return {
    ...fieldEvidence,
    relevance: "none",
    reason,
    subjectRejectionReason: reason,
    alternativeCharacterEvidence: extra.alternativeCharacterEvidence === true,
    subjectValidated: true,
  };
}

function acceptEval(fieldEvidence, reason, extra = {}) {
  let relevance = fieldEvidence.relevance;
  if (extra.capDirect && relevance === "direct") {
    relevance = "supporting";
  }
  return {
    ...fieldEvidence,
    relevance,
    subjectReason: reason,
    subjectRejectionReason: null,
    alternativeCharacterEvidence: false,
    subjectValidated: true,
  };
}

function heroineLanguage(source) {
  return HEROINE_CUES.test(sourceSubjectBlob(source));
}

/**
 * Bind field-level phenomenon matches to the correct character subject.
 */
export function validateFieldEvidenceSubject({
  field,
  fieldEvidence,
  subject,
  identity,
  source = null,
  mixedSeparated = false,
} = {}) {
  const requirement = fieldSubjectRequirement(field);
  const status = subject?.subjectStatus || "unknown";
  const hasIdentity = hasSubjectIdentity(identity);
  if (!hasIdentity || requirement === "none") {
    return {
      ...fieldEvidence,
      subjectReason: null,
      subjectRejectionReason: null,
      subjectValidated: false,
    };
  }

  const altMeta = { alternativeCharacterEvidence: true };

  if (requirement === "mmc") {
    if (status === "target") {
      return acceptEval(fieldEvidence, FIELD_MATCH_TARGET_MMC);
    }
    if (status === "mixed") {
      if (mixedSeparated) {
        return acceptEval(fieldEvidence, FIELD_MATCH_TARGET_MMC);
      }
      return acceptEval(fieldEvidence, FIELD_MATCH_TARGET_MMC, { capDirect: true });
    }
    if (status === "alternative") {
      return rejectEval(fieldEvidence, FIELD_MATCH_ALTERNATIVE_CHARACTER, altMeta);
    }
    if (status === "target_fmc") {
      return rejectEval(fieldEvidence, FIELD_MATCH_WRONG_SUBJECT);
    }
    return rejectEval(fieldEvidence, FIELD_MATCH_AMBIGUOUS_SUBJECT);
  }

  if (requirement === "fmc") {
    if (status === "alternative" && !subject?.targetFmcMentioned && !heroineLanguage(source)) {
      return rejectEval(fieldEvidence, FIELD_MATCH_ALTERNATIVE_CHARACTER, altMeta);
    }
    return acceptEval(fieldEvidence, FIELD_MATCH_TARGET_FMC);
  }

  if (requirement === "fmc_or_general") {
    if (status === "alternative" && !subject?.targetFmcMentioned) {
      return rejectEval(fieldEvidence, FIELD_MATCH_ALTERNATIVE_CHARACTER, altMeta);
    }
    return acceptEval(
      fieldEvidence,
      status === "target_fmc" ? FIELD_MATCH_TARGET_FMC : FIELD_MATCH_TARGET_MMC
    );
  }

  if (requirement === "pairing") {
    if (status === "alternative") {
      return rejectEval(fieldEvidence, FIELD_MATCH_ALTERNATIVE_CHARACTER, altMeta);
    }
    const pair =
      (subject?.targetMmcMentioned && subject?.targetFmcMentioned) ||
      status === "target" ||
      (status === "mixed" && subject?.targetMmcMentioned);
    if (pair) {
      return acceptEval(fieldEvidence, FIELD_MATCH_TARGET_PAIRING, {
        capDirect: status === "mixed" && !mixedSeparated,
      });
    }
    if (status === "target_fmc") {
      return rejectEval(fieldEvidence, FIELD_MATCH_WRONG_SUBJECT);
    }
    return rejectEval(fieldEvidence, FIELD_MATCH_AMBIGUOUS_SUBJECT);
  }

  return {
    ...fieldEvidence,
    subjectValidated: false,
  };
}

export function attachSubjectHintsToSource(source, identity) {
  if (!source || !hasSubjectIdentity(identity)) return source;
  const subject = evaluateSourceSubject(source, identity);
  return {
    ...source,
    subjectHints: buildSubjectHints(subject),
  };
}

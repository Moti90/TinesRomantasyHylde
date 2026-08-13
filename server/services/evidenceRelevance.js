/**
 * Lightweight field-specific evidence relevance (Bid 3 Fase B).
 *
 * Distinguishes "source is about the character" from
 * "source contains evidence for this Tine field".
 *
 * Bid 3 Fase B.1.3 adds subject binding: field matches only count
 * when the source is about the relevant character/pairing.
 *
 * Used by coverage, adaptive round value, and benchmark diagnostics.
 * Not ground truth — human labels remain independent.
 *
 * Does not import adaptiveResearch (avoids circular deps).
 */

import {
  buildSubjectHints,
  evaluateSourceSubject,
  fieldSubjectRequirement,
  hasSubjectIdentity,
  subjectIdentityFrom,
  targetSubjectClauses,
  validateFieldEvidenceSubject,
} from "./sourceSubject.js";

export const RELEVANCE_LEVELS = ["direct", "supporting", "contextual", "none"];

export const STUDY_GUIDE_HOSTS = [
  "sparknotes.com",
  "gradesaver.com",
  "supersummary.com",
  "shmoop.com",
  "litcharts.com",
  "cliffnotes.com",
  "cliffsnotes.com",
  "fandom.com",
  "commonsensemedia.org",
  "thebookfeed.com",
  "explained.today",
  "tvtropes.org",
  "tropetrove.com",
];

const READER_EXPERIENCE_TYPES = new Set([
  "forum",
  "blog",
  "professional",
  "goodreads",
]);

const BIBLIOGRAPHIC_TYPES = new Set(["catalog", "official", "publisher"]);

const HER = "(?:her|them|the heroine|[A-ZÆØÅ][\\w'’-]+)";
export const FIELD_PHENOMENON_SPEC = {
  "Touch her and die-vibe (0-5)": {
    direct: [
      /touch her and die/i,
      /hurt (?:her|them) and die/i,
      /kill (?:anyone|anybody|him|them) who (?:touches|hurts|looks|threatens)/i,
      /would (?:kill|murder) (?:anyone|anybody|him) who/i,
      /goes feral/i,
      new RegExp(
        `reacts? violently when ${HER} (?:is |are )?(?:attacked|threatened|hurt)`,
        "i"
      ),
      /violent(?:ly)? protect(?:ive|s|ion)?/i,
      /protective rage/i,
      /(?:brutally )?attacks? (?:anyone|anybody) who threatens/i,
      /dr[æe]be for hende/i,
    ],
    supporting: [
      /would (?:die|kill) for (?:her|them|his mate)/i,
      /threaten(?:s|ed|ing)? (?:anyone|anybody|everyone) who/i,
      /possessive (?:and )?(?:protective|rage)/i,
      /fiercely protective when (?:she|they).{0,40}(?:threat|danger|attack|hurt)/i,
    ],
    negative: [
      /not (?:a |an )?(?:touch her and die|thad)/i,
      /no (?:particular |real )?(?:violent|extreme) (?:protect|reaction)/i,
    ],
  },
  "Bodyguard-vibe (0-5)": {
    direct: [
      /\bbodyguard\b/i,
      /personal guard/i,
      /assigned to protect/i,
      /places? (?:himself|herself) between/i,
      new RegExp(`steps? between ${HER} and (?:danger|harm|threat)`, "i"),
      /guardian dynamic/i,
      /pass(?:es)? on you/i,
      /jeg passer p[åa] dig/i,
      /"jeg passer p[åa] dig"/i,
    ],
    supporting: [
      new RegExp(`guards? ${HER}`, "i"),
      new RegExp(`watching over ${HER}`, "i"),
      new RegExp(`keeps? watch over ${HER}`, "i"),
      new RegExp(
        `shield(?:s|ing)? ${HER} from (?:danger|harm|attack)`,
        "i"
      ),
      new RegExp(`keeps? ${HER} (?:safe|protected)`, "i"),
      new RegExp(`secretly ensures? ${HER}.{0,40}protection`, "i"),
      new RegExp(`fiercely protective of ${HER}`, "i"),
      new RegExp(`refuses? to leave ${HER} unprotected`, "i"),
    ],
    negative: [
      /no (?:bodyguard|guardian) (?:vibe|dynamic)/i,
      /not (?:a |her |his )?bodyguard/i,
      /not assigned to protect/i,
      /little guardian dynamic/i,
      /she (?:generally )?protects herself/i,
      /relationship has little guardian/i,
    ],
  },
  "Beskyttende helt(e) (0-5)": {
    direct: [
      new RegExp(
        `protect(?:ive|s|ing) (?:behavior |behaviour )?(?:of |towards )?${HER}`,
        "i"
      ),
      /protective (?:behavior|behaviour)/i,
      /protective (?:mmc|hero|male lead|instinct)/i,
      new RegExp(
        `(?:brutally )?attacks? (?:anyone|anybody) who threatens ${HER}`,
        "i"
      ),
      new RegExp(`steps? between ${HER} and (?:danger|harm|threat)`, "i"),
      /beskytt(?:er|ende)/i,
      new RegExp(`looks? after ${HER}`, "i"),
      new RegExp(`keeps? ${HER} (?:safe|protected)`, "i"),
      new RegExp(
        `repeatedly (?:protects|shields) ${HER}`,
        "i"
      ),
    ],
    supporting: [
      /\bguardian\b/i,
      /caretak/i,
      new RegExp(`shield(?:s|ing)? ${HER}`, "i"),
      /fiercely protective\b/i,
      new RegExp(`keeps? watch over ${HER}`, "i"),
    ],
    negative: [
      /not (?:particularly |especially )?protective/i,
      /she (?:generally )?protects herself/i,
      /he is not protective/i,
      /ingen beskytt/i,
    ],
  },
  "Rhysand-faktoren": {
    direct: [
      /respect(?:s|ful(?:ly)?) (?:her|her agency|her power|her choices|her decisions|her autonomy|the heroine)/i,
      /supports? her (?:power|growth|agency|independence|choices|development|autonomy|decisions)/i,
      /support for her (?:autonomy|agency|independence|choices|power)/i,
      /treats? her as (?:an )?equal/i,
      /empowers? her/i,
      /equal partner/i,
      /lader hende vokse/i,
      /beskytter uden at kontroll/i,
      /protect(?:s|ive) without (?:control|controlling)/i,
    ],
    supporting: [
      /emotionally loyal/i,
      /loyal (?:to her|partner|and respectful)/i,
      /morally grey but (?:loyal|respectful|equal)/i,
      /her autonomy/i,
    ],
    negative: [
      /does not respect (?:her|her agency)/i,
      /controlling (?:and|not) (?:not )?respect/i,
      /pure bully/i,
    ],
  },
  "Spice/erotik (0-5)": {
    direct: [
      /\bspice\b/i,
      /\bsteamy\b/i,
      /\berotic\b/i,
      /explicit (?:sex|scenes?)/i,
      /fade to black/i,
      /open door/i,
      /chili\s*pepper/i,
    ],
    supporting: [/intimate scenes?/i, /on[- ]page (?:sex|romance)/i],
    negative: [/no spice/i, /closed door/i, /no on[- ]page sex/i],
  },
  "Spice/erotik kvalitet (0-5)": {
    direct: [
      /spice (?:quality|is (?:well[- ]written|excellent|poor|filler))/i,
      /well[- ]written (?:intimate|sex|spice) scenes?/i,
      /spice (?:scenes? )?(?:are|feel) (?:filler|meaningful|gratuitous)/i,
    ],
    supporting: [/intimate scenes? (?:are|feel)/i],
    negative: [],
  },
  "Romance i fokus (0-100%)": {
    direct: [
      /romance[- ](?:focused|forward|heavy|driven)/i,
      /romance (?:is|takes) (?:the )?focus/i,
      /romance (?:vs\.?|versus) plot/i,
    ],
    supporting: [/\bromantasy\b/i, /central romance/i],
    negative: [/romance is secondary/i, /plot[- ]focused with little romance/i],
  },
  "Worldbuilding (0-5)": {
    direct: [/world[\s-]?building/i, /intricate (?:magic|world)/i, /magic system/i],
    supporting: [/rich world/i],
    negative: [],
  },
  "Episk plot (0-5)": {
    direct: [/\bepic (?:plot|scale|stakes|fantasy)\b/i, /grand (?:scale|plot)/i],
    supporting: [/high stakes/i, /\bepic\b/i],
    negative: [],
  },
  "Politiske intriger (0-5)": {
    direct: [/political intrigue/i, /court intrigue/i, /politisk/i],
    supporting: [/power play/i],
    negative: [],
  },
  "Krig/militær (0-5)": {
    direct: [/\b(?:war|military|army)\b/i, /krig|militær/i],
    supporting: [/\bbattle\b/i, /\bsoldier\b/i],
    negative: [],
  },
  "Karakterudvikling (0-5)": {
    direct: [/character developments?/i, /character arcs?/i, /karakterudvikling/i],
    supporting: [
      /grows as a (?:person|character)/i,
      /grows? in (?:confidence|power|agency)/i,
    ],
    negative: [],
  },
  "Kvindelig udvikling (0-5)": {
    direct: [
      /heroine(?:'s)? (?:growth|arc|development)/i,
      /female (?:character )?(?:growth|development|arc)/i,
      /grows? in (?:confidence|power|agency)/i,
      /becomes? more (?:confident|independent|powerful)/i,
    ],
    supporting: [
      /strong heroine/i,
      /relationship supports? (?:her )?development/i,
    ],
    negative: [],
  },
  "Book hangover (0-5)": {
    direct: [/book hangover/i, /couldn'?t put (?:it|the book) down/i],
    supporting: [/still thinking about (?:it|the book)/i],
    negative: [],
  },
  "Hvor hurtigt griber den? (0-100%)": {
    direct: [/grabs? (?:you|the reader) (?:immediately|quickly|from page)/i],
    supporting: [/slow burn to hook/i, /pacing.{0,20}hook/i],
    negative: [],
  },
};

/** Flat pattern lists for backward-compatible synonym matching. */
export const FIELD_PHENOMENON_PATTERNS = Object.fromEntries(
  Object.entries(FIELD_PHENOMENON_SPEC).map(([field, spec]) => [
    field,
    [...(spec.direct || []), ...(spec.supporting || [])],
  ])
);

const RHYSAND_ASPECTS = {
  respect: [
    /respect(?:s|ful(?:ly)?) (?:her|her agency|her power|her choices|her decisions|her autonomy|the heroine)/i,
    /supports? her (?:power|growth|agency|independence|choices|development|autonomy|decisions)/i,
    /support for her (?:autonomy|agency|independence|choices|power)/i,
    /treats? her as (?:an )?equal/i,
    /empowers? her/i,
    /equal partner/i,
    /lader hende vokse/i,
  ],
  protectWithoutControl: [
    /beskytter uden at kontroll/i,
    /protect(?:s|ive) without (?:control|controlling)/i,
  ],
  loyal: [/emotionally loyal/i, /loyal (?:to her|partner)/i],
  greyWithRespect: [/morally grey but (?:loyal|respectful|equal)/i],
};

const POWER_ONLY = [
  /\bpowerful\b/i,
  /\bdangerous\b/i,
  /\bruthless\b/i,
  /\bdominant\b/i,
  /\balpha\b/i,
  /\bwingleader\b/i,
];

const CHARACTER_CONTEXT = [
  /\b(mmc|fmc|heroine|hero|protagonist|character|wingleader|love interest|romantic lead|relationship|pairing|male lead|female lead)\b/i,
];

const SUBJECTIVE_TROPE_FIELDS = new Set([
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Rhysand-faktoren",
  "Spice/erotik kvalitet (0-5)",
  "Book hangover (0-5)",
  "Romance i fokus (0-100%)",
]);

export function sourceTextBlob(source) {
  return `${source?.title || ""} ${source?.summary || ""} ${source?.snippet || ""}`;
}

export function isStudyGuideUrl(url = "") {
  const u = String(url || "").toLowerCase();
  return STUDY_GUIDE_HOSTS.some((h) => u.includes(h));
}

export function isGoodreadsDiscussionUrl(url = "") {
  const u = String(url || "").toLowerCase();
  if (!u.includes("goodreads.com")) return false;
  return /\/(review|topic|questions|ask_the_author)\b/i.test(u);
}

export function isGoodreadsLandingUrl(url = "") {
  const u = String(url || "").toLowerCase();
  if (!u.includes("goodreads.com")) return false;
  return /\/book\/show\//i.test(u) && !isGoodreadsDiscussionUrl(u);
}

export function classifySourceRole(source = {}) {
  const url = String(source?.url || "");
  const type = String(source?.type || "").toLowerCase();
  if (isStudyGuideUrl(url)) return "study_guide";
  if (BIBLIOGRAPHIC_TYPES.has(type)) return "bibliographic";
  if (type === "wikipedia") return "encyclopedia";
  if (type === "forum" || isGoodreadsDiscussionUrl(url)) return "reader_experience";
  if (type === "blog" || type === "professional") return "reader_experience";
  if (type === "goodreads") {
    return isGoodreadsLandingUrl(url) ? "catalog_social" : "reader_experience";
  }
  return "other";
}

export function isReaderExperienceSource(source = {}) {
  const role = classifySourceRole(source);
  if (role === "reader_experience") return true;
  return READER_EXPERIENCE_TYPES.has(String(source?.type || "").toLowerCase()) &&
    !isStudyGuideUrl(source?.url);
}

function matchPayload(directHits, supportingHits, negativeHits = []) {
  return {
    matchedDirectPatterns: directHits,
    matchedSupportingPatterns: supportingHits,
    matchedNegativePatterns: negativeHits,
  };
}

function matchAny(patterns, blob) {
  const matched = [];
  for (const re of patterns || []) {
    if (re.test(blob)) matched.push(String(re));
  }
  return matched;
}

function rhysandAspectCount(blob) {
  let n = 0;
  const matched = [];
  for (const [name, patterns] of Object.entries(RHYSAND_ASPECTS)) {
    if (matchAny(patterns, blob).length) {
      n += 1;
      matched.push(name);
    }
  }
  return { count: n, matched };
}

function isCharacterContext(blob, source) {
  if (CHARACTER_CONTEXT.some((re) => re.test(blob))) return true;
  const batch = source?.batch || source?.focus;
  return batch === "helteprofil" || batch === "romanceprofil";
}

function emptyEval(source, field, extra = {}) {
  return {
    sourceId: source?.id || null,
    field,
    relevance: "none",
    reason: extra.reason || "no field-specific evidence",
    matchedPhenomena: extra.matchedPhenomena || [],
    polarity: extra.polarity || "none",
    sourceRole: classifySourceRole(source),
    ...extra,
  };
}

function resolveEvalIdentity(context = {}) {
  return subjectIdentityFrom(context.research || {}, context.identity || {}, {
    mmc: context.mmc,
    fmc: context.fmc,
    alternatives: context.alternatives,
    leadCharacters: context.leadCharacters,
  });
}

function evaluateFieldPhenomena({
  source,
  field,
  assessment = null,
  context = {},
} = {}) {
  if (!source || !field) {
    return emptyEval(source, field, { reason: "missing source or field" });
  }

  const blob = sourceTextBlob(source);
  const role = classifySourceRole(source);
  const spec = FIELD_PHENOMENON_SPEC[field] || {
    direct: [],
    supporting: [],
    negative: [],
  };

  const negative = matchAny(spec.negative, blob);
  if (negative.length) {
    return {
      sourceId: source.id || null,
      field,
      relevance: "direct",
      reason: "explicit negative evidence for the field",
      matchedPhenomena: negative,
      polarity: "negative",
      sourceRole: role,
      ...matchPayload([], [], negative),
    };
  }

  if (field === "Rhysand-faktoren") {
    const aspects = rhysandAspectCount(blob);
    const powerOnly = matchAny(POWER_ONLY, blob);
    if (aspects.count >= 2) {
      let relevance = "direct";
      if (SUBJECTIVE_TROPE_FIELDS.has(field) && role === "study_guide") {
        relevance = "supporting";
      }
      return {
        sourceId: source.id || null,
        field,
        relevance,
        reason: `multiple handbook Rhysand-factor aspects: ${aspects.matched.join(", ")}`,
        matchedPhenomena: aspects.matched,
        polarity: "positive",
        sourceRole: role,
        ...matchPayload(aspects.matched, [], []),
      };
    }
    if (aspects.count === 1) {
      return {
        sourceId: source.id || null,
        field,
        relevance: "supporting",
        reason: `one handbook Rhysand-factor aspect: ${aspects.matched[0]}`,
        matchedPhenomena: aspects.matched,
        polarity: "positive",
        sourceRole: role,
        ...matchPayload([], aspects.matched, []),
      };
    }
    if (powerOnly.length && !aspects.count) {
      return {
        sourceId: source.id || null,
        field,
        relevance: "contextual",
        reason: "power/danger/grey language without respect/agency/loyalty",
        matchedPhenomena: [],
        polarity: "none",
        sourceRole: role,
        ...matchPayload([], [], []),
      };
    }
  }

  const directHits = matchAny(spec.direct, blob);
  const supportingHits = matchAny(spec.supporting, blob);

  let relevance = "none";
  let matched = [];
  if (directHits.length) {
    relevance = "direct";
    matched = directHits;
  } else if (supportingHits.length) {
    relevance = "supporting";
    matched = supportingHits;
  }

  if (field === "Bodyguard-vibe (0-5)" && relevance === "direct") {
    const onlyProtective =
      directHits.length === 0 &&
      /protect(?:ive|s|ing)\b/i.test(blob) &&
      !/\bbodyguard\b|personal guard|assigned to protect|guardian dynamic/i.test(blob);
    if (onlyProtective) relevance = "supporting";
  }

  if (field === "Touch her and die-vibe (0-5)" && relevance === "supporting") {
    if (
      /protect(?:s|ive|ing)\b/i.test(blob) &&
      !/feral|kill|violent|rage|die|threaten/i.test(blob)
    ) {
      /* generic protect is not THAD supporting unless already matched THAD patterns */
    }
  }

  if (SUBJECTIVE_TROPE_FIELDS.has(field) && role === "study_guide") {
    if (relevance === "direct") {
      relevance = "supporting";
    }
  }

  if (relevance === "direct" || relevance === "supporting") {
    return {
      sourceId: source.id || null,
      field,
      relevance,
      reason:
        relevance === "direct"
          ? "source describes the field phenomenon directly"
          : "source describes closely related behaviour",
      matchedPhenomena: matched,
      polarity: "positive",
      sourceRole: role,
      ...matchPayload(
        relevance === "direct" ? directHits : [],
        relevance === "supporting" ? supportingHits : directHits.length ? [] : supportingHits,
      ),
    };
  }

  const cited =
    Array.isArray(assessment?.evidenceSourceIds) &&
    source.id &&
    assessment.evidenceSourceIds.includes(source.id);
  const aboutCharacter = isCharacterContext(blob, source);

  if (aboutCharacter || cited || role === "study_guide") {
    return {
      sourceId: source.id || null,
      field,
      relevance: "contextual",
      reason: cited
        ? "cited for the field but summary lacks field-specific evidence"
        : "source is about the character/work without field-specific evidence",
      matchedPhenomena: [],
      polarity: "none",
      sourceRole: role,
      cited: Boolean(cited),
    };
  }

  return emptyEval(source, field, {
    sourceRole: role,
    reason: context?.defaultReason || "no relevant information",
  });
}

/**
 * Deterministic source×field relevance, then subject validation when identity is known.
 */
export function evaluateSourceForField({
  source,
  field,
  assessment = null,
  context = {},
} = {}) {
  const identity = resolveEvalIdentity(context);
  let evalSource = source;
  let mixedSeparated = false;
  let subject = null;
  if (source && hasSubjectIdentity(identity)) {
    subject = evaluateSourceSubject(source, identity);
    const requirement = fieldSubjectRequirement(field);
    if (
      subject.subjectStatus === "mixed" &&
      (requirement === "mmc" || requirement === "pairing")
    ) {
      const parts = targetSubjectClauses(source, identity);
      mixedSeparated = parts.separated;
      if (parts.separated && parts.targetBlob) {
        evalSource = {
          ...source,
          title: source.title || "",
          summary: parts.targetBlob,
          snippet: "",
        };
      }
    }
  }

  const raw = evaluateFieldPhenomena({
    source: evalSource,
    field,
    assessment,
    context,
  });
  if (!subject) {
    return {
      ...raw,
      rawRelevance: raw.relevance,
      validatedRelevance: raw.relevance,
    };
  }

  const validated = validateFieldEvidenceSubject({
    field,
    fieldEvidence: raw,
    subject,
    identity,
    source,
    mixedSeparated,
  });
  return {
    ...validated,
    rawRelevance: raw.relevance,
    validatedRelevance: validated.relevance,
    subject,
    subjectHints: buildSubjectHints(subject),
  };
}

export function isFieldSpecificEvidence(evaluation) {
  return (
    evaluation?.relevance === "direct" || evaluation?.relevance === "supporting"
  );
}

export function hasTargetFieldSignal(source, targetFields = [], context = {}) {
  const fields = [...new Set((targetFields || []).filter(Boolean))];
  if (!source || !fields.length) return false;
  return fields.some((field) =>
    isFieldSpecificEvidence(evaluateSourceForField({ source, field, context }))
  );
}

export function evaluateSourcesForFields({
  sources = [],
  fields = [],
  assessments = {},
  context = {},
} = {}) {
  const evaluations = [];
  const byField = {};
  for (const field of fields || []) {
    byField[field] = [];
    const assessment = assessments?.[field] || null;
    for (const source of sources || []) {
      const ev = evaluateSourceForField({
        source,
        field,
        assessment,
        context,
      });
      evaluations.push(ev);
      byField[field].push(ev);
    }
  }
  return { evaluations, byField };
}

export function countRelevance(evaluations = []) {
  const counts = { direct: 0, supporting: 0, contextual: 0, none: 0 };
  for (const ev of evaluations) {
    if (counts[ev.relevance] != null) counts[ev.relevance] += 1;
  }
  return counts;
}

export function criticalFieldStopQualitySatisfied({
  directSources = [],
  supportingSources = [],
  score = null,
} = {}) {
  if (score == null) return false;
  if (directSources.length >= 1) return true;
  const independentSupporting = supportingSources.filter(
    (s) => classifySourceRole(s) !== "study_guide"
  );
  return independentSupporting.length >= 2;
}

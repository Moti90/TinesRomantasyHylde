import { SUBJECTIVE_KEYS } from "./decisionScores.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "./evidenceRelevance.js";
import { subjectIdentityFrom } from "./sourceSubject.js";

export { FIELD_PHENOMENON_PATTERNS } from "./evidenceRelevance.js";

export const FIELD_TO_BATCH = {
  "Beskyttende helt(e) (0-5)": "helteprofil",
  "Bodyguard-vibe (0-5)": "helteprofil",
  "Touch her and die-vibe (0-5)": "helteprofil",
  "Rhysand-faktoren": "helteprofil",
  "Spice/erotik (0-5)": "romanceprofil",
  "Spice/erotik kvalitet (0-5)": "romanceprofil",
  "Romance i fokus (0-100%)": "romanceprofil",
  "Worldbuilding (0-5)": "plotkarakter",
  "Episk plot (0-5)": "plotkarakter",
  "Politiske intriger (0-5)": "plotkarakter",
  "Krig/militær (0-5)": "plotkarakter",
  "Kvindelig udvikling (0-5)": "plotkarakter",
  "Karakterudvikling (0-5)": "plotkarakter",
  "Book hangover (0-5)": "helhed",
  "Hvor hurtigt griber den? (0-100%)": "helhed",
};

export function batchCountsFromResearch(research) {
  const counts = { helteprofil: 0, romanceprofil: 0, plotkarakter: 0, helhed: 0 };
  for (const s of research?.sources || []) {
    if (counts[s.batch] != null) counts[s.batch] += 1;
  }
  return counts;
}

export function findPhenomenonSourceIds(fieldKey, research) {
  const batch = FIELD_TO_BATCH[fieldKey];
  const sources = research?.sources || [];
  const context = {
    research,
    leadCharacters: research?.seriesIdentity,
    ...subjectIdentityFrom(research, {}, { leadCharacters: research?.seriesIdentity }),
  };
  const matched = [];
  for (const s of sources) {
    if (!s?.id) continue;
    if (s.purpose === "identity") continue;
    const ev = evaluateSourceForField({ source: s, field: fieldKey, context });
    if (isFieldSpecificEvidence(ev)) matched.push(s);
  }
  matched.sort((a, b) => {
    const pa = a.batch === batch ? 0 : 1;
    const pb = b.batch === batch ? 0 : 1;
    return pa - pb;
  });
  return [...new Set(matched.map((s) => s.id))];
}

export function normalizeAssessment(a, fieldKey = null, research = null) {
  const defaultBatch = fieldKey ? FIELD_TO_BATCH[fieldKey] || null : null;
  const batches = batchCountsFromResearch(research);
  const identityConfidence =
    research?.identity?.confidence ||
    research?.identity?.identityConfidence ||
    "low";
  const sourceBatch =
    ["helteprofil", "romanceprofil", "plotkarakter", "helhed"].includes(
      a?.sourceBatch
    )
      ? a.sourceBatch
      : defaultBatch;
  const sourceCount =
    typeof a?.sourceCount === "number"
      ? a.sourceCount
      : sourceBatch
        ? batches[sourceBatch] || 0
        : 0;

  if (!a || typeof a !== "object") {
    return {
      score: null,
      confidence: "low",
      basis: "insufficient",
      reason: "Ikke verificeret",
      sourceBatch: defaultBatch,
      sourceCount: defaultBatch ? batches[defaultBatch] || 0 : 0,
      evidenceSourceIds: [],
      conflictingSourceIds: [],
    };
  }

  let score = a.score;
  if (score === "" || score === undefined) score = null;
  if (typeof score === "string" && score.trim() !== "") {
    const m = score.match(/(\d+(?:\.\d+)?)/);
    score = m ? Number(m[1]) : null;
  }
  if (typeof score === "number" && Number.isNaN(score)) score = null;

  let confidence = ["high", "medium", "low"].includes(a.confidence)
    ? a.confidence
    : "low";
  let basis = [
    "source_consensus",
    "mixed_sources",
    "synopsis_only",
    "ai_inference",
    "insufficient",
  ].includes(a.basis)
    ? a.basis
    : score != null
      ? "ai_inference"
      : "insufficient";

  const evidence = Array.isArray(a.evidenceSourceIds)
    ? [...new Set(a.evidenceSourceIds.filter(Boolean))]
    : [];
  const evidenceCount = evidence.length;
  const strength = evidenceCount > 0 ? evidenceCount : sourceCount;

  if (evidenceCount <= 1 && confidence === "high") {
    confidence = "medium";
  }
  if (basis === "ai_inference" && confidence === "high") {
    confidence = "medium";
  }
  const allowsModelInference =
    score != null &&
    ["ai_inference", "synopsis_only"].includes(basis) &&
    ["high", "medium"].includes(identityConfidence);
  if (sourceBatch && sourceCount === 0 && evidenceCount === 0) {
    if (allowsModelInference) {
      confidence = "low";
    } else {
      score = null;
      confidence = "low";
      basis = "insufficient";
    }
  } else if (strength < 2 && confidence === "high") {
    confidence = "medium";
  } else if (
    strength < 2 &&
    confidence === "medium" &&
    evidenceCount === 0 &&
    !["source_consensus", "mixed_sources"].includes(basis)
  ) {
    confidence = "low";
  }

  if (
    score != null &&
    evidenceCount >= 1 &&
    ["source_consensus", "mixed_sources"].includes(basis) &&
    confidence === "low"
  ) {
    confidence = "medium";
  }

  if (basis === "insufficient" && score == null) {
    return {
      score: null,
      confidence: "low",
      basis,
      reason:
        a.reason ||
        (sourceBatch && sourceCount === 0
          ? `Ikke verificeret — ingen kilder i batch "${sourceBatch}".`
          : "Ikke nok information"),
      sourceBatch,
      sourceCount,
      evidenceSourceIds: evidence,
      conflictingSourceIds: Array.isArray(a.conflictingSourceIds)
        ? a.conflictingSourceIds
        : [],
    };
  }
  if (basis === "insufficient" && score != null) {
    basis = "ai_inference";
    if (confidence === "high") confidence = "medium";
  }

  let reason = String(a.reason || "").slice(0, 500);
  if (sourceBatch && sourceCount === 0 && allowsModelInference) {
    const prefix =
      basis === "synopsis_only"
        ? "Vurderet ud fra bogbeskrivelsen"
        : "Vurderet ud fra modelviden";
    if (!reason.toLowerCase().startsWith(prefix.toLowerCase())) {
      reason = reason
        ? `${prefix}: ${reason}`
        : `${prefix} uden direkte kildebelæg.`;
    }
  }

  return {
    score,
    confidence,
    basis,
    reason,
    sourceBatch,
    sourceCount,
    evidenceSourceIds: evidence,
    conflictingSourceIds: Array.isArray(a.conflictingSourceIds)
      ? a.conflictingSourceIds
      : [],
    traitsFound: Array.isArray(a.traitsFound) ? a.traitsFound : undefined,
  };
}

function consensusScoreHint(consensusEntry) {
  if (!consensusEntry) return null;
  const c = consensusEntry.consensus;
  if (c === "strong") return 5;
  if (c === "moderate") return 4;
  if (c === "weak") return 2;
  if (c === "mixed") return 3;
  if (c === "insufficient") return null;
  return null;
}

/** Map research.reviewConsensus → handbook-felter når AI glemmer dem. */
export const CONSENSUS_FIELD_MAP = {
  worldbuilding: "Worldbuilding (0-5)",
  politicalIntrigue: "Politiske intriger (0-5)",
  warMilitary: "Krig/militær (0-5)",
  protective: "Beskyttende helt(e) (0-5)",
  touchHerAndDie: "Touch her and die-vibe (0-5)",
  spice: "Spice/erotik (0-5)",
  pacing: null,
  romanceFocus: "Romance i fokus (0-100%)",
  romancefokus: "Romance i fokus (0-100%)",
  rhysandLikeTraits: "Rhysand-faktoren",
  characterGrowth: "Karakterudvikling (0-5)",
  epicPlot: "Episk plot (0-5)",
  emotionalIntensity: "Book hangover (0-5)",
};

function isWeakInference(a) {
  if (!a || a.score == null) return true;
  if (a.basis === "insufficient") return true;
  if (a.basis !== "ai_inference") return false;
  return /serieidentitet|tilgængelig research|ai_inference|sat lavt frem for tomt|estimeret ud fra/i.test(
    String(a.reason || "")
  );
}

export function applyConsensusFallbacks(assessments, research) {
  const cons = research?.reviewConsensus || {};
  for (const [ck, field] of Object.entries(CONSENSUS_FIELD_MAP)) {
    if (!field) continue;
    const entry = cons[ck];
    if (!entry) continue;
    const hint = consensusScoreHint(entry);
    const current = assessments[field];
    const supportIds = Array.isArray(entry.supportingSourceIds)
      ? entry.supportingSourceIds.filter(Boolean)
      : [];

    if (current?.score != null && !isWeakInference(current)) {
      if (supportIds.length && !(current.evidenceSourceIds || []).length) {
        current.evidenceSourceIds = supportIds;
        if (["ai_inference", "synopsis_only"].includes(current.basis)) {
          current.basis = "source_consensus";
        }
        if (current.confidence === "low" && supportIds.length >= 1) {
          current.confidence = "medium";
        }
        current.sourceCount = Math.max(current.sourceCount || 0, supportIds.length);
      }
      continue;
    }
    if (hint == null) continue;
    const isPct = field.includes("0-100");
    assessments[field] = {
      score: isPct ? Math.round((hint / 5) * 100) : hint,
      confidence:
        entry.confidence === "high" || supportIds.length >= 2
          ? "medium"
          : entry.confidence === "medium" && supportIds.length >= 1
            ? "medium"
            : "low",
      basis: "source_consensus",
      reason: entry.finding || "Baseret på research-konsensus.",
      sourceBatch: FIELD_TO_BATCH[field] || null,
      sourceCount: Math.max(supportIds.length, 1),
      evidenceSourceIds: supportIds,
      conflictingSourceIds: Array.isArray(entry.conflictingSourceIds)
        ? entry.conflictingSourceIds
        : [],
    };
  }
  return assessments;
}

export function extractExplicitSourceRatings(research) {
  const sources = research?.sources || [];
  const collected = {};

  const rules = [
    {
      field: "Worldbuilding (0-5)",
      re: /world[\s-]?buildings?\b[^0-9]{0,50}?(\d(?:[.,]\d)?)\s*(?:\/\s*5|out of 5|stars?|stjerner)?/i,
    },
    {
      field: "Karakterudvikling (0-5)",
      re: /character\s*developments?\b[^0-9]{0,50}?(\d(?:[.,]\d)?)\s*(?:\/\s*5|out of 5|stars?|stjerner)?/i,
    },
    {
      field: "Episk plot (0-5)",
      re: /plot\s*(?:&|and)?\s*pacings?\b[^0-9]{0,50}?(\d(?:[.,]\d)?)\s*(?:\/\s*5|stars?)?/i,
    },
    {
      field: "Spice/erotik (0-5)",
      re: /(?:spice(?:\s*(?:level|rating))?|between the sheets|chili\s*peppers?)\b[^0-9]{0,40}?(\d(?:[.,]\d)?)\s*(?:\/\s*5|chili|🌶)?/i,
    },
    {
      field: "Kvindelig udvikling (0-5)",
      re: /(?:female\s*character|heroine)\s*developments?\b[^0-9]{0,40}?(\d(?:[.,]\d)?)/i,
    },
  ];

  for (const s of sources) {
    const blob = `${s.title || ""} ${s.summary || ""}`;
    const id = s.id || null;
    for (const rule of rules) {
      const m = blob.match(rule.re);
      if (!m?.[1]) continue;
      const raw = Number(String(m[1]).replace(",", "."));
      if (Number.isNaN(raw) || raw < 0 || raw > 5) continue;
      if (!collected[rule.field]) collected[rule.field] = [];
      collected[rule.field].push({
        raw,
        id,
        title: String(s.title || s.url || "kilde").slice(0, 60),
      });
    }
  }

  const out = {};
  for (const [field, hits] of Object.entries(collected)) {
    if (!hits.length) continue;
    const avg = hits.reduce((s, h) => s + h.raw, 0) / hits.length;
    const score = Math.max(0, Math.min(5, Math.round(avg)));
    const min = Math.min(...hits.map((h) => h.raw));
    const max = Math.max(...hits.map((h) => h.raw));
    const spread = max - min;
    let confidence = "low";
    if (hits.length >= 2 && spread <= 1) confidence = "medium";
    if (hits.length >= 3 && spread <= 1) confidence = "high";
    if (hits.length >= 2 && spread > 2) confidence = "low";

    const ids = [...new Set(hits.map((h) => h.id).filter(Boolean))];
    const sample = hits
      .map((h) => `${h.raw}`)
      .slice(0, 5)
      .join(", ");
    out[field] = {
      score,
      raw: avg,
      confidence,
      basis: spread > 2 ? "mixed_sources" : "source_consensus",
      reason:
        hits.length === 1
          ? `Eksplicit rating i kilde (${hits[0].raw}/5 → ${score}): ${hits[0].title}`
          : `Gennemsnit af ${hits.length} eksplicitte ratings [${sample}] → ${avg.toFixed(1)} ≈ ${score}.`,
      evidenceSourceIds: ids,
      conflictingSourceIds: spread > 2 ? ids.slice(1) : [],
      sourceCount: hits.length,
    };
  }
  return out;
}

export function applyExplicitSourceRatings(assessments, research) {
  const extracted = extractExplicitSourceRatings(research);
  for (const [field, hit] of Object.entries(extracted)) {
    if (!isWeakInference(assessments[field])) continue;
    const batch = FIELD_TO_BATCH[field] || null;
    assessments[field] = {
      score: hit.score,
      confidence: hit.confidence,
      basis: "source_consensus",
      reason: hit.reason,
      sourceBatch: batch,
      sourceCount: hit.sourceCount,
      evidenceSourceIds: hit.evidenceSourceIds || [],
      conflictingSourceIds: [],
    };
  }
  return assessments;
}

/**
 * Kobl fænomen-beskrivelser i kilder til assessments:
 * opgrader ai_inference → source_consensus og udfyld evidenceSourceIds.
 */
export function attachPhenomenonEvidence(assessments, research) {
  const cons = research?.reviewConsensus || {};
  for (const field of SUBJECTIVE_KEYS) {
    const idsFromSources = findPhenomenonSourceIds(field, research);
    const consKey = Object.entries(CONSENSUS_FIELD_MAP).find(
      ([, f]) => f === field
    )?.[0];
    const entry = consKey ? cons[consKey] : null;
    const consIds =
      entry &&
      entry.consensus &&
      entry.consensus !== "insufficient" &&
      Array.isArray(entry.supportingSourceIds)
        ? entry.supportingSourceIds.filter(Boolean)
        : [];
    const ids = [...new Set([...idsFromSources, ...consIds])];
    if (!ids.length) continue;

    const a = assessments[field];
    const conflicts = Array.isArray(entry?.conflictingSourceIds)
      ? entry.conflictingSourceIds.filter(Boolean)
      : [];

    if (!a || a.score == null) {
      const hint = entry ? consensusScoreHint(entry) : null;
      if (hint == null && idsFromSources.length < 2) continue;
      const isPct = field.includes("0-100");
      const score =
        hint != null
          ? isPct
            ? Math.round((hint / 5) * 100)
            : hint
          : isPct
            ? 70
            : 4;
      assessments[field] = {
        score,
        confidence: ids.length >= 2 ? "medium" : "low",
        basis: conflicts.length ? "mixed_sources" : "source_consensus",
        reason:
          entry?.finding ||
          `Kilder beskriver fænomenet for "${field}" (også med andre ord).`,
        sourceBatch: FIELD_TO_BATCH[field] || null,
        sourceCount: ids.length,
        evidenceSourceIds: ids,
        conflictingSourceIds: conflicts,
      };
      continue;
    }

    const existing = Array.isArray(a.evidenceSourceIds)
      ? a.evidenceSourceIds.filter(Boolean)
      : [];
    const merged = [...new Set([...existing, ...ids])];
    const needsUpgrade =
      ["ai_inference", "synopsis_only", "insufficient"].includes(a.basis) ||
      existing.length === 0;

    if (!needsUpgrade && merged.length === existing.length) continue;

    a.evidenceSourceIds = merged;
    a.sourceBatch = a.sourceBatch || FIELD_TO_BATCH[field] || null;
    a.sourceCount = Math.max(Number(a.sourceCount) || 0, merged.length);
    if (["ai_inference", "synopsis_only", "insufficient"].includes(a.basis)) {
      a.basis = conflicts.length ? "mixed_sources" : "source_consensus";
    }
    if (a.confidence === "low" && merged.length >= 1) {
      a.confidence = "medium";
    }
    if (
      !a.reason ||
      /ingen direkte|ikke verificeret|modelviden|uden direkte kildebelæg/i.test(
        String(a.reason)
      )
    ) {
      a.reason =
        entry?.finding ||
        `Kilder beskriver fænomenet (også med andre ord); score ${a.score}.`;
    }
    if (conflicts.length && !(a.conflictingSourceIds || []).length) {
      a.conflictingSourceIds = conflicts;
    }
    assessments[field] = a;
  }
  return assessments;
}

export function fillIdentifiedGaps(assessments, research) {
  const conf = research?.identity?.confidence || "low";
  const known = conf === "high" || conf === "medium";
  if (!known) return assessments;
  const batches = batchCountsFromResearch(research);

  for (const key of SUBJECTIVE_KEYS) {
    const a = assessments[key];
    if (a?.score != null) continue;

    const batch = FIELD_TO_BATCH[key];
    const n = batch ? batches[batch] || 0 : 0;

    if (batch && n === 0) {
      assessments[key] = {
        score: null,
        confidence: "low",
        basis: "insufficient",
        reason: `Ikke verificeret — ingen kilder i batch "${batch}".`,
        sourceBatch: batch,
        sourceCount: 0,
        evidenceSourceIds: [],
        conflictingSourceIds: [],
      };
      continue;
    }

    assessments[key] = {
      score: null,
      confidence: "low",
      basis: "insufficient",
      reason: batch
        ? `Ikke verificeret — ${n} kilde(r) i batch "${batch}", men ingen beskriver dette fænomen (heller ikke med andre ord).`
        : "Ikke nok information",
      sourceBatch: batch || null,
      sourceCount: n,
      evidenceSourceIds: [],
      conflictingSourceIds: [],
    };
  }
  return assessments;
}

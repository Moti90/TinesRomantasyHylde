/**
 * C.1.3 field-aware evidence quality.
 *
 * Answers only: how suitable is this source *role* for this field/claim class?
 * Does not re-decide direct/supporting/contextual or subject validity.
 *
 * evaluateSourceForField remains the relevance + subject layer.
 * Coverage uses this layer after those checks.
 */

import { classifySourceRole } from "./evidenceRelevance.js";

export const QUALITY_TIERS = ["strong", "usable", "weak", "ineligible"];

export const FIELD_QUALITY_CLASSES = {
  "Beskyttende helt(e) (0-5)": "behavior",
  "Bodyguard-vibe (0-5)": "behavior",
  "Touch her and die-vibe (0-5)": "behavior",
  "Rhysand-faktoren": "relationship",
  "Kvindelig udvikling (0-5)": "fmc_development",
  "Karakterudvikling (0-5)": "character_development",
  "Book hangover (0-5)": "reader_experience",
  "Hvor hurtigt griber den? (0-100%)": "reader_experience",
  "Spice/erotik kvalitet (0-5)": "reader_experience",
  "Romance i fokus (0-100%)": "reader_experience",
  "Spice/erotik (0-5)": "content_descriptor",
  "Worldbuilding (0-5)": "narrative",
  "Episk plot (0-5)": "narrative",
  "Politiske intriger (0-5)": "narrative",
  "Krig/militær (0-5)": "narrative",
};

const TIER_RANK = {
  strong: 3,
  usable: 2,
  weak: 1,
  ineligible: 0,
};

const USABLE_ANALYSIS_CLASSES = new Set([
  "behavior",
  "relationship",
  "fmc_development",
  "character_development",
  "narrative",
  "content_descriptor",
]);

function emptyQuality(extra = {}) {
  return {
    eligible: false,
    qualityTier: "ineligible",
    coverageBucket: null,
    weight: 0,
    reason: extra.reason || "not_field_specific",
    sourceRole: extra.sourceRole || null,
    fieldClass: extra.fieldClass || null,
  };
}

export function fieldQualityClass(field) {
  return FIELD_QUALITY_CLASSES[field] || "narrative";
}

export function qualityTierRank(tier) {
  return TIER_RANK[tier] || 0;
}

export function bestQualityTier(tiers = []) {
  let best = "ineligible";
  for (const tier of tiers) {
    if (qualityTierRank(tier) > qualityTierRank(best)) best = tier;
  }
  return best;
}

function roleClassQuality(sourceRole, fieldClass) {
  if (sourceRole === "bibliographic") {
    return { qualityTier: "ineligible", reason: "low_field_quality" };
  }
  if (sourceRole === "catalog_social") {
    if (fieldClass === "reader_experience") {
      return {
        qualityTier: "ineligible",
        reason: "reader_experience_wrong_role",
      };
    }
    if (USABLE_ANALYSIS_CLASSES.has(fieldClass)) {
      return { qualityTier: "usable", reason: "catalog_social_demoted" };
    }
    return { qualityTier: "ineligible", reason: "low_field_quality" };
  }
  if (sourceRole === "study_guide" || sourceRole === "encyclopedia") {
    if (fieldClass === "reader_experience") {
      return {
        qualityTier: "ineligible",
        reason: "reader_experience_wrong_role",
      };
    }
    if (USABLE_ANALYSIS_CLASSES.has(fieldClass)) {
      return {
        qualityTier: "usable",
        reason:
          sourceRole === "study_guide"
            ? "study_guide_demoted"
            : "usable_analysis_source",
      };
    }
    return { qualityTier: "ineligible", reason: "low_field_quality" };
  }
  if (sourceRole === "reader_experience") {
    return { qualityTier: "strong", reason: "strong_reader_source" };
  }
  return { qualityTier: "weak", reason: "low_field_quality" };
}

/**
 * @param {{ source: object, field: string, relevance: string, context?: object }} args
 * @returns {{
 *   eligible: boolean,
 *   qualityTier: "strong"|"usable"|"weak"|"ineligible",
 *   coverageBucket: "direct"|"supporting"|null,
 *   weight: number,
 *   reason: string,
 *   sourceRole: string,
 *   fieldClass: string,
 * }}
 */
export function evaluateEvidenceQualityForField({
  source,
  field,
  relevance,
  context: _context = {},
} = {}) {
  const sourceRole = classifySourceRole(source);
  const fieldClass = fieldQualityClass(field);
  const rel = String(relevance || "none");

  if (source?.purpose === "identity") {
    return emptyQuality({
      sourceRole,
      fieldClass,
      reason: "identity_only",
    });
  }

  if (rel !== "direct" && rel !== "supporting") {
    return emptyQuality({
      sourceRole,
      fieldClass,
      reason: rel === "contextual" ? "generic_claim" : "not_field_specific",
    });
  }

  const { qualityTier, reason } = roleClassQuality(sourceRole, fieldClass);
  if (qualityTier === "ineligible" || qualityTier === "weak") {
    return {
      eligible: false,
      qualityTier,
      coverageBucket: null,
      weight: 0,
      reason,
      sourceRole,
      fieldClass,
    };
  }

  const coverageBucket = qualityTier === "usable" ? "supporting" : rel;
  const weight =
    qualityTier === "strong" ? (rel === "direct" ? 1 : 0.65) : 0.45;

  return {
    eligible: true,
    qualityTier,
    coverageBucket,
    weight,
    reason,
    sourceRole,
    fieldClass,
  };
}

export function isIndependentStopQualitySource(source) {
  const role = classifySourceRole(source);
  return role !== "study_guide" && role !== "encyclopedia";
}

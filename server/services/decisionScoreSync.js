import { calculateReadPriority } from "./decisionScores.js";
import {
  applyLearnedTasteAdjustment,
  formatLearnedTasteReason,
} from "./learnedTaste.js";

export function applyDecisionScoresToRow(row, analysisMeta = null) {
  const baseScore = row["Tine-score"] ?? row.Indholdsmatch ?? null;
  const lockedReference = Boolean(row._scoreReference?.locked);

  let contentMatch = baseScore;
  let learned = null;
  if (
    !lockedReference &&
    baseScore != null &&
    !Number.isNaN(Number(baseScore))
  ) {
    learned = applyLearnedTasteAdjustment(row, Number(baseScore));
    contentMatch = learned.score;
  }

  row.Indholdsmatch = contentMatch;
  if (learned?.delta) {
    row._learnedTaste = {
      baseScore: Number(baseScore),
      delta: learned.delta,
      reasons: learned.reasons,
      reviewCount: learned.reviewCount,
      appliedAt: new Date().toISOString(),
    };
  } else if (row._learnedTaste && !lockedReference) {
    delete row._learnedTaste;
  }

  const uncertainty = analysisMeta?.uncertainty || { level: "thin" };
  const readPriority = calculateReadPriority(row, contentMatch, uncertainty);
  row["Læseprioritet nu"] = readPriority.score;

  if (analysisMeta) {
    analysisMeta.readPriority = readPriority;
    if (!analysisMeta.assessments) analysisMeta.assessments = {};
    const prior =
      analysisMeta.assessments.Indholdsmatch ||
      analysisMeta.assessments["Tine-score"] ||
      {};
    analysisMeta.assessments.Indholdsmatch = lockedReference
      ? {
          score: contentMatch,
          confidence: "high",
          basis: "source_consensus",
          reason: "Indholdsmatch følger det låste pejlemærke fra Tines Excel-ark.",
          evidenceSourceIds: [],
          conflictingSourceIds: [],
        }
      : {
          ...prior,
          score: contentMatch,
          reason: formatLearnedTasteReason(
            learned,
            prior.reason ||
              (learned?.delta
                ? ""
                : "Samme smagsberegning som Tine-score, uden anmeldelsesjustering endnu."),
          ),
        };
    analysisMeta.assessments["Læseprioritet nu"] = {
      score: readPriority.score,
      confidence:
        uncertainty.level === "strong"
          ? "high"
          : uncertainty.level === "medium"
            ? "medium"
            : "low",
      basis: "mixed_sources",
      reason: readPriority.reason,
      evidenceSourceIds: [],
      conflictingSourceIds: [],
    };
  }

  return { row, readPriority, learned };
}

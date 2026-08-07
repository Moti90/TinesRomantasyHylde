import { calculateReadPriority } from "./decisionScores.js";

export function applyDecisionScoresToRow(row, analysisMeta = null) {
  const contentMatch = row["Tine-score"] ?? row.Indholdsmatch ?? null;
  row.Indholdsmatch = contentMatch;
  const uncertainty = analysisMeta?.uncertainty || { level: "thin" };
  const readPriority = calculateReadPriority(row, contentMatch, uncertainty);
  row["Læseprioritet nu"] = readPriority.score;

  if (analysisMeta) {
    analysisMeta.readPriority = readPriority;
    if (!analysisMeta.assessments) analysisMeta.assessments = {};
    const lockedReference = row._scoreReference?.locked;
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
          ...(analysisMeta.assessments.Indholdsmatch ||
            analysisMeta.assessments["Tine-score"] ||
            {}),
          score: contentMatch,
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

  return { row, readPriority };
}

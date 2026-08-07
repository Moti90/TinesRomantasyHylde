export const SUBJECTIVE_KEYS = [
  "Book hangover (0-5)",
  "Worldbuilding (0-5)",
  "Episk plot (0-5)",
  "Politiske intriger (0-5)",
  "Krig/militær (0-5)",
  "Kvindelig udvikling (0-5)",
  "Karakterudvikling (0-5)",
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "Rhysand-faktoren",
  "Hvor hurtigt griber den? (0-100%)",
  "Romance i fokus (0-100%)",
];

const UNCERTAINTY_FACTS = [
  ["publishedBookCount", "Antal bøger"],
  ["audiobook", "Lydbog"],
  ["mofiboAvailability", "Mofibo"],
  ["seriesStatus", "Seriestatus"],
  ["danishEdition", "Dansk udgave"],
  ["sameMainCouple", "Samme hovedpar"],
];

export function estimateTineScoreFromVibes(row) {
  const keys = [
    ["Beskyttende helt(e) (0-5)", 1.35],
    ["Bodyguard-vibe (0-5)", 1.35],
    ["Touch her and die-vibe (0-5)", 1.4],
    ["Rhysand-faktoren", 1.4],
    ["Kvindelig udvikling (0-5)", 1.25],
    ["Karakterudvikling (0-5)", 1.15],
    ["Spice/erotik kvalitet (0-5)", 1.05],
    ["Book hangover (0-5)", 0.95],
    ["Episk plot (0-5)", 0.85],
    ["Worldbuilding (0-5)", 0.8],
    ["Politiske intriger (0-5)", 0.7],
    ["Krig/militær (0-5)", 0.7],
  ];
  let sum = 0;
  let weight = 0;
  let scored = 0;
  for (const [key, w] of keys) {
    const n = Number(row[key]);
    if (Number.isNaN(n)) continue;
    sum += Math.max(0, Math.min(5, n)) * w;
    weight += w;
    scored += 1;
  }
  if (!weight || scored < 3) return null;

  const romancePct = Number(
    String(row["Romance i fokus (0-100%)"] ?? "").replace(/[^\d.]/g, "")
  );
  let romanceAdj = 0;
  if (!Number.isNaN(romancePct)) {
    romanceAdj = ((romancePct - 45) / 100) * 10;
  }

  const coreKeys = [
    "Bodyguard-vibe (0-5)",
    "Touch her and die-vibe (0-5)",
    "Rhysand-faktoren",
    "Spice/erotik kvalitet (0-5)",
  ];
  let coreSum = 0;
  let coreN = 0;
  for (const key of coreKeys) {
    const n = Number(row[key]);
    if (Number.isNaN(n)) continue;
    coreSum += n;
    coreN += 1;
  }
  const coreAvg = coreN ? coreSum / coreN : 2.5;
  let coreAdj = 0;
  if (coreAvg <= 1.5) coreAdj = -8;
  else if (coreAvg >= 4) coreAdj = 5;

  const avg = sum / weight;
  const raw = 52 + (avg / 5) * 44 + romanceAdj + coreAdj;
  return Math.max(40, Math.min(99, Math.round(raw)));
}

export function buildUncertaintyProfile(research, assessments) {
  const rows = SUBJECTIVE_KEYS.map((key) => [key, assessments?.[key]]).filter(
    ([, assessment]) => assessment
  );
  const scoredRows = rows.filter(([, assessment]) => assessment.score != null);
  const sourceBackedRows = scoredRows.filter(
    ([, assessment]) =>
      (assessment.evidenceSourceIds?.length || 0) > 0 ||
      (assessment.sourceCount || 0) > 0
  );
  const lowConfidenceFields = scoredRows
    .filter(([, assessment]) => assessment.confidence === "low")
    .map(([key]) => key);
  const inferredFields = scoredRows
    .filter(([, assessment]) =>
      ["ai_inference", "synopsis_only"].includes(assessment.basis)
    )
    .map(([key]) => key);
  const notVerifiedFacts = UNCERTAINTY_FACTS.filter(([key]) => {
    const fact = research?.facts?.[key];
    return !fact || fact.status === "not_verified" || fact.value == null;
  }).map(([, label]) => label);
  const sourceCoverage = Math.round(
    (sourceBackedRows.length / Math.max(SUBJECTIVE_KEYS.length, 1)) * 100
  );
  const scoreCoverage = Math.round(
    (scoredRows.length / Math.max(SUBJECTIVE_KEYS.length, 1)) * 100
  );
  const staleOrMissingFreshFacts = notVerifiedFacts.filter((label) =>
    ["Lydbog", "Mofibo", "Seriestatus"].includes(label)
  );
  const researchedAt = Date.parse(research?.researchedAt || "");
  if (
    !Number.isNaN(researchedAt) &&
    Date.now() - researchedAt > 30 * 24 * 60 * 60 * 1000
  ) {
    staleOrMissingFreshFacts.push("Research er ældre end 30 dage");
  }

  let level = "thin";
  if (
    sourceCoverage >= 60 &&
    lowConfidenceFields.length <= 3 &&
    notVerifiedFacts.length <= 2
  ) {
    level = "strong";
  } else if (
    sourceCoverage >= 30 &&
    lowConfidenceFields.length <= 8 &&
    notVerifiedFacts.length <= 4
  ) {
    level = "medium";
  }

  return {
    level,
    sourceCoverage,
    scoreCoverage,
    lowConfidenceFields,
    inferredFields,
    notVerifiedFacts,
    staleOrMissingFreshFacts,
  };
}

function lowerValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function calculateReadPriority(row, contentMatch, uncertainty) {
  const baseScore = Number(contentMatch);
  if (contentMatch == null || Number.isNaN(baseScore)) {
    return {
      score: null,
      baseScore: null,
      totalAdjustment: 0,
      adjustments: [],
      reason: "Indholdsmatch mangler, så læseprioriteten kan ikke beregnes.",
    };
  }

  const adjustments = [];
  const add = (key, label, points, reason) => {
    adjustments.push({ key, label, points, reason });
  };

  const seriesStatus = lowerValue(row["Er serien færdigskrevet"]);
  if (!seriesStatus) {
    add(
      "series_unknown",
      "Seriestatus ikke verificeret",
      -3,
      "Det er uklart, om serien kan læses færdig nu."
    );
  } else if (
    seriesStatus === "nej" ||
    seriesStatus.includes("ikke færdig") ||
    seriesStatus.includes("igang")
  ) {
    add(
      "series_unfinished",
      "Serien er ikke færdig",
      -10,
      "En uafsluttet serie er mindre oplagt at starte på nu."
    );
  }

  const mofibo = lowerValue(
    row["Er serien på Mofibo? (ja, nej, ikke hele serien)"]
  );
  if (!mofibo) {
    add(
      "mofibo_unknown",
      "Mofibo ikke verificeret",
      -2,
      "Tilgængeligheden på Mofibo er ukendt."
    );
  } else if (mofibo.includes("ikke hele")) {
    add(
      "mofibo_partial",
      "Ikke hele serien er på Mofibo",
      -4,
      "Kun en del af serien ser ud til at være tilgængelig."
    );
  } else if (mofibo === "nej" || mofibo.includes("ikke på")) {
    add(
      "mofibo_no",
      "Ikke på Mofibo",
      -8,
      "Serien er mindre praktisk at starte på lige nu."
    );
  }

  const audiobook = lowerValue(row["Lydbog (ja/nej, ikke hele serien)"]);
  if (!audiobook) {
    add(
      "audiobook_unknown",
      "Lydbog ikke verificeret",
      -1,
      "Det er uklart, om bogen findes som lydbog."
    );
  } else if (audiobook === "nej") {
    add(
      "audiobook_no",
      "Ingen lydbog fundet",
      -4,
      "Manglende lydbog gør bogen mindre tilgængelig."
    );
  }

  const bully = lowerValue(row["Bully-risiko"]);
  if (bully.includes("høj") || bully === "high") {
    add(
      "bully_high",
      "Høj bully-risiko",
      -12,
      "Det er en tydelig risiko i forhold til Tines præferencer."
    );
  } else if (bully.includes("middel") || bully.includes("medium")) {
    add(
      "bully_medium",
      "Middel bully-risiko",
      -5,
      "Der kan være en dynamik, som trækker læselysten ned."
    );
  }

  const ending = lowerValue(row["Tilfredsstillende slutning?"]);
  if (ending === "nej" || ending.includes("utilfredsstillende")) {
    add(
      "ending_unsatisfying",
      "Utilfredsstillende slutning",
      -8,
      "Slutningen er en kendt risiko for læseoplevelsen."
    );
  }

  const permanentDeaths = lowerValue(
    row["Permanente dødsfald blandt hovedpersonerne?"]
  );
  if (permanentDeaths === "ja" || permanentDeaths === "yes") {
    add(
      "permanent_main_death",
      "Permanent dødsfald blandt hovedpersoner",
      -20,
      "Det er et tydeligt no go i Tines læseprofil."
    );
  }

  const qualityDrop = lowerValue(row["Falder kvaliteten?"]);
  if (qualityDrop === "ja" || qualityDrop === "yes") {
    add(
      "quality_drop",
      "Kvaliteten falder senere",
      -6,
      "Et kendt kvalitetsfald gør serien mindre oplagt at starte på."
    );
  }

  if (uncertainty?.level === "thin") {
    add(
      "thin_foundation",
      "Tyndt analysegrundlag",
      -7,
      "Flere vurderinger eller praktiske oplysninger er usikre."
    );
  } else if (uncertainty?.level === "medium") {
    add(
      "medium_foundation",
      "Delvist analysegrundlag",
      -3,
      "Nogle vurderinger eller praktiske oplysninger er usikre."
    );
  }

  const totalAdjustment = adjustments.reduce(
    (sum, adjustment) => sum + adjustment.points,
    0
  );
  const score = Math.max(
    0,
    Math.min(100, Math.round(baseScore + totalAdjustment))
  );
  return {
    score,
    baseScore: Math.round(baseScore),
    totalAdjustment,
    adjustments,
    reason: adjustments.length
      ? `Starter ved indholdsmatch ${Math.round(baseScore)} og justeres ${totalAdjustment} point for praktiske forhold og analysegrundlag.`
      : "Samme score som indholdsmatch, fordi der ikke blev fundet praktiske forhold, som trækker ned.",
  };
}

import { readFileSync } from "fs";
import { COLUMNS, emptySeries } from "./columns.js";
import { getOpenAIKey } from "./config.js";
import { getCalibrationAnchors } from "./calibration.js";
import { analysisInputHash } from "./hash.js";
import {
  ANALYSIS_MODEL,
  ANALYSIS_PROMPT_VERSION,
  HANDBOOK_VERSION,
  estimateCostUsd,
} from "./versions.js";
import { resolveGoodreadsScore, sanitizeGoodreadsScore } from "./goodreads.js";
import { summarizeSourceFoundation } from "./webResearch.js";
import { dataPath } from "./paths.js";
import {
  SUBJECTIVE_KEYS,
  buildUncertaintyProfile,
  calculateReadPriority,
  estimateTineScoreFromVibes,
} from "./decisionScores.js";
import {
  normalizeAssessment,
  applyConsensusFallbacks,
  applyExplicitSourceRatings,
  attachPhenomenonEvidence,
  fillIdentifiedGaps,
  extractExplicitSourceRatings,
  findPhenomenonSourceIds,
} from "./evidenceMapping.js";

const handbook = readFileSync(dataPath("handbook.md"), "utf8");

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ingen JSON i analysesvar");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function formatGoodreads(gr) {
  if (!gr || gr.value == null) return null;
  if (gr.source && gr.source !== "Goodreads") return null;
  const n = Number(gr.value);
  if (Number.isNaN(n) || n < 0 || n > 5) return null;
  return n;
}

function displayUnverified(value) {
  if (value == null || value === "") return null;
  return value;
}

function factValue(fact) {
  if (!fact) return null;
  if (fact.status === "not_verified") return null;
  return fact.value ?? null;
}

function sanitizeCatalogForPrompt(catalog) {
  if (!catalog || typeof catalog !== "object") return catalog;
  const {
    verifiedRating,
    ratingDisplay,
    openLibraryRating,
    openLibraryRatingCount,
    googleRating,
    unverifiedDefaults,
    ...safe
  } = catalog;
  return {
    ...safe,
    // Katalog-ratings er IKKE Goodreads — sendes kun som separate felter
    catalogRatings: {
      openLibrary:
        openLibraryRating != null
          ? { value: openLibraryRating, count: openLibraryRatingCount || null }
          : null,
      googleBooks: googleRating != null ? { value: googleRating } : null,
      note: "Disse er IKKE Goodreads. Sæt aldrig Goodreads-score ud fra dem.",
    },
  };
}

function isStubTineScore(predicted) {
  if (!predicted || predicted.score == null) return true;
  const reason = String(predicted.reason || "").toLowerCase();
  if (predicted.score === 75) return true;
  if (reason.includes("estimeret helhedsscore")) return true;
  return false;
}

function resolveTineScore(row, predicted) {
  const fromVibes = estimateTineScoreFromVibes(row);
  const ai = predicted?.score;

  if (fromVibes == null) {
    return {
      score: ai ?? null,
      confidence: predicted?.confidence || "low",
      basis: predicted?.basis || "insufficient",
      reason: predicted?.reason || "Ikke nok vibe-scorer til Tine-score",
      evidenceSourceIds: predicted?.evidenceSourceIds || [],
      conflictingSourceIds: predicted?.conflictingSourceIds || [],
    };
  }

  let score = fromVibes;
  let basis = "source_consensus";
  let reason =
    "Beregnet ud fra håndbogens vægte (episk plot, worldbuilding, udvikling, beskyttende vibes, Rhysand m.m.).";
  let confidence = "medium";

  if (ai != null && !isStubTineScore(predicted)) {
    score = Math.round(fromVibes * 0.7 + Number(ai) * 0.3);
    basis = "mixed_sources";
    reason = `${reason} Nuanceret med AI-helhedsvurdering (${ai}).`;
    confidence = predicted.confidence || "medium";
  }

  return {
    score: Math.max(40, Math.min(99, score)),
    confidence,
    basis,
    reason,
    evidenceSourceIds: predicted?.evidenceSourceIds || [],
    conflictingSourceIds: predicted?.conflictingSourceIds || [],
  };
}

function buildAnalysisPrompt({ research, catalog, mofibo, query }) {
  const anchors = getCalibrationAnchors(5);
  const safeCatalog = sanitizeCatalogForPrompt(catalog);
  const idConf = research?.identity?.confidence || "low";
  return `Du vurderer én romantasy-/fantasy-serie efter Tines håndbog.
Du må IKKE søge på nettet. Brug den medsendte research + din viden om serien når den er identificeret.

Kildeprioritet: kilder er organiseret i 4 batches (sources[].batch):
- helteprofil: MMC's personlighed og relation (beskyttende, bodyguard, touch her and die, Rhysand, bully)
- romanceprofil: spice, romance-balance, relationstype
- plotkarakter: plot-skala, politiske intriger, krig, udvikling, tempo
- helhed: læseoplevelse, serie-kvalitet, hangover, slutning, sammenligninger

Når du vurderer et felt, brug PRIMÆRT kilder fra den relevante batch.
Hvis en kilde har EKSPLICIT rating (fx "World-Building 4/5", "Character Development 4.5 stars", "spice 3 chili"),
skal den indgå i vurderingen. Flere eksplicitte ratings for samme felt → brug GENNEMSNIT (afrundet til 0–5),
ikke den højeste alene. Stor uenighed → lavere confidence og nævn spredningen i reason.

SKEL MELLEM FAKTA OG SUBJEKTIVE VURDERINGER:
- [FAKTA]: Antal bøger, lydbog, Mofibo, seriestatus, Goodreads og andre objektive oplysninger må KUN komme fra research.facts, ratings eller verificerede kilder. Mangler det, returnér null / not_verified. Brug aldrig modelviden til at udfylde fakta.
- [SUBJEKTIV]: Rhysand-faktor, Touch Her And Die, beskyttelse, bodyguard-vibe, romance, spice-kvalitet, worldbuilding, udvikling, book hangover og lignende er vurderinger. Brug først kilder og reviewConsensus.
- Hvis værket er identificeret med high eller medium sikkerhed, men den relevante batch har 0 direkte kilder, SKAL du stadig give din bedste konkrete subjektive score, når din modelviden eller bogbeskrivelsen giver et meningsfuldt grundlag. Brug basis "ai_inference" eller "synopsis_only", confidence "low", sourceCount 0 og tomme evidenceSourceIds. Forklar præcist hvad vurderingen bygger på.
- Hvis identiteten er low, eller du reelt ikke har et meningsfuldt grundlag, brug score null, basis "insufficient" og forklar hvorfor.
- Sæt ALDRIG en standard-midt (fx 3) uden en konkret begrundelse. Gæt ikke "typisk romantasy".

Når du scorer et subjektivt felt: Hvis mindst én kilde beskriver det fænomen feltet handler om (uanset om de bruger håndbogens præcise termer), så sæt en score, basis "source_consensus", evidenceSourceIds med kilde-id'erne, og confidence "medium" ved 1–2 fænomen-kilder (high kun ved 3+ og stærk enighed).
Synonym-eksempler (beskrivelse = belæg):
- Touch her and die: "would kill for her", "goes feral", "hurt her and die", "dræbe for hende"
- Bodyguard: "keeps her safe", "guards her", "watching over her", "bodyguard"
- Beskyttende: "protective MMC", "guardian", "beskytter hende"
- Rhysand: "respects her agency", "supports her power", "equal partner", "morally grey but loyal"
Hvis en batch har færre end 2 kilder MEN mindst én kilde beskriver fænomenet: confidence medium er OK. Uden fænomen-belæg: hold confidence på low.
For hvert assessment: inkluder "sourceBatch" og "sourceCount". reason skal nævne konkret kilde når muligt.

Når batch HAR belæg: udfyld scores (0 = fraværende, ikke "ved ikke").
basis "source_consensus" når scoren bygger på anmeldelser eller fænomen-beskrivelser; "ai_inference" kun hvis du må bruge generel seriekendskab OG reason siger præcist hvad.
Skeln serier: kopiér aldrig tal fra én serie til den næste.

A) FAKTA — kun fra research.facts / ratings.goodreads. Ellers null / not_verified.
   Udfyld IKKE Goodreads-score i fields (serveren sætter det). Open Library ≠ Goodreads.
B) SUBJEKTIVE VURDERINGER — udfyld nøgler nedenfor med score + reason + sourceBatch + sourceCount.
   Brug reviewConsensus når den findes. Formålet er at skille Tines romantasy-match fra irrelevant fantasy.
C) tineOwnScore og tineOwnReview = null.
   predictedTineScore: ærligt 0–100. Høj kun ved stærk romantasy-profil.
   Episk plot/worldbuilding alene er IKKE nok til høj Tine-score.

Rhysand-faktoren: respekt, loyalitet, støtte, beskyttende uden kontrol — ikke kun "mørk/magtfuld".

HÅNDBOG (${HANDBOOK_VERSION}):
${handbook}

KALIBRERING (Excel-reference / Tines egne scores):
Brug disse ankre til at ramme samme skala som den scorede database.
scoreSource "tines_egen" = Tine har sat scoren selv (tungest).
scoreSource "excel_reference" = tidligere håndbog-/Excel-score (reference).
Hvis ny serie minder om høje ankre → højere Tine-score / tropes.
Hvis den minder om lave ankre → lavere. Kopiér ikke tallene blindt.
${JSON.stringify(anchors, null, 2)}

WEBRESEARCH:
${JSON.stringify(research, null, 2)}

KATALOG:
${JSON.stringify(safeCatalog || {}, null, 2)}

MOFIBO: ${JSON.stringify(mofibo || {})}
QUERY: ${query || ""}

Returnér KUN JSON. Udfyld assessments for DENNE konkrete serie — kopiér IKKE eksemplets tal.
Eksempel FORMAT (fiktive tal):
{
  "fields": {
    "Seriens navn": "...",
    "Første bog/titel": "...",
    "Forfatter": "...",
    "Antal bøger i serien": null,
    "Lydbog (ja/nej, ikke hele serien)": null,
    "Er serien på Mofibo? (ja, nej, ikke hele serien)": null,
    "Er serien færdigskrevet": null,
    "Relation": "MF",
    "Tempo": "Moderat",
    "Worldbuilding-tags": "...",
    "Chosen one eller vokser naturligt ind i rollen?": "...",
    "Bully-risiko": "Lav",
    "FemDom (ja/nej)": "Nej",
    "Falder kvaliteten?": null,
    "Happy ending?": null,
    "Tilfredsstillende slutning?": null,
    "Trigger warnings": "...",
    "Permanente dødsfald blandt hovedpersonerne?": null,
    "Romance sekundær eller central?": "...",
    "Minder mest om": "...",
    "Hvis du savner...": "..."
  },
  "assessments": {
    "Book hangover (0-5)": { "score": "<0-5 eller null>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "helhed", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Worldbuilding (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Episk plot (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Politiske intriger (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Krig/militær (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Kvindelig udvikling (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Karakterudvikling (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "plotkarakter", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Beskyttende helt(e) (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "helteprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Bodyguard-vibe (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "helteprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Touch her and die-vibe (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "helteprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Spice/erotik (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "romanceprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Spice/erotik kvalitet (0-5)": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "romanceprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Rhysand-faktoren": { "score": "<0-5>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "helteprofil", "sourceCount": 0, "traitsFound": [], "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Hvor hurtigt griber den? (0-100%)": { "score": "<0-100>", "confidence": "low", "basis": "synopsis_only", "reason": "...", "sourceBatch": "helhed", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] },
    "Romance i fokus (0-100%)": { "score": "<0-100>", "confidence": "low", "basis": "ai_inference", "reason": "...", "sourceBatch": "romanceprofil", "sourceCount": 0, "evidenceSourceIds": [], "conflictingSourceIds": [] }
  },
  "predictedTineScore": { "score": "<50-99 unikt for denne serie>", "confidence": "medium", "basis": "ai_inference", "reason": "Begrund ud fra DENNE series tropes — ikke et standardtal.", "evidenceSourceIds": [], "conflictingSourceIds": [] },
  "tineOwnScore": null,
  "tineOwnReview": null,
  "userMessage": null
}`;
}

function mapSeriesStatus(fact) {
  const v = factValue(fact);
  if (v == null) return null;
  const s = String(v).toLowerCase();
  if (s.includes("finish") || s.includes("afslut") || s.includes("complete")) {
    return "Ja";
  }
  if (s.includes("ongoing") || s.includes("igang") || s.includes("ikke færdig")) {
    return "Nej";
  }
  return String(v);
}

function applyResearchFacts(row, research, mofibo, { existingRow = null, updateGoodreads = true } = {}) {
  const f = research?.facts || {};
  const books = factValue(f.publishedBookCount);
  if (books != null) row["Antal bøger i serien"] = books;
  else row["Antal bøger i serien"] = null;

  const audio = factValue(f.audiobook);
  row["Lydbog (ja/nej, ikke hele serien)"] = audio ?? null;

  row["Er serien færdigskrevet"] = mapSeriesStatus(f.seriesStatus);

  const mofiboFact = factValue(f.mofiboAvailability);
  if (mofiboFact != null) {
    row["Er serien på Mofibo? (ja, nej, ikke hele serien)"] = mofiboFact;
  } else if (mofibo?.status && mofibo.status !== "Ikke verificeret") {
    row["Er serien på Mofibo? (ja, nej, ikke hele serien)"] = mofibo.status;
  } else {
    row["Er serien på Mofibo? (ja, nej, ikke hele serien)"] = null;
  }

  // Goodreads: kun verificeret Goodreads — aldrig Open Library / Google Books
  if (updateGoodreads) {
    row["Goodreads-score"] = resolveGoodreadsScore({
      verifiedGoodreads: research?.ratings?.goodreads,
      existingValue: existingRow?.["Goodreads-score"],
      preserveExisting: true,
    });
  } else {
    row["Goodreads-score"] = sanitizeGoodreadsScore(
      existingRow?.["Goodreads-score"] ?? row["Goodreads-score"]
    );
  }

  if (research?.identity?.title) {
    row["Første bog/titel"] =
      row["Første bog/titel"] || research.identity.title;
  }
  if (research?.identity?.author) {
    row.Forfatter = row.Forfatter || research.identity.author;
  }
  if (research?.identity?.series) {
    row["Seriens navn"] =
      row["Seriens navn"] || research.identity.series;
  }
  return row;
}

function assessmentsToRow(
  parsed,
  research,
  mofibo,
  query,
  { existingRow = null, updateGoodreads = true } = {}
) {
  const row = emptySeries();
  const fields = parsed.fields || {};
  for (const col of COLUMNS) {
    // AI må aldrig styre Goodreads — det sættes kun fra verificeret research
    if (col === "Goodreads-score") continue;
    if (fields[col] !== undefined) row[col] = displayUnverified(fields[col]);
  }

  const assessments = {};
  for (const key of SUBJECTIVE_KEYS) {
    assessments[key] = normalizeAssessment(
      parsed.assessments?.[key],
      key,
      research
    );
  }
  applyConsensusFallbacks(assessments, research);
  applyExplicitSourceRatings(assessments, research);
  attachPhenomenonEvidence(assessments, research);
  fillIdentifiedGaps(assessments, research);

  for (const key of SUBJECTIVE_KEYS) {
    assessments[key] = normalizeAssessment(assessments[key], key, research);
    const score = assessments[key].score;
    if (score != null) row[key] = score;
    else row[key] = null;
  }

  const predictedRaw = normalizeAssessment(parsed.predictedTineScore);
  const predicted = resolveTineScore(row, predictedRaw);
  assessments["Tine-score"] = predicted;
  row["Tine-score"] = predicted.score;

  // AI må aldrig sætte Tines egne felter
  row["Tines score"] = null;
  row["Tines egen vurdering"] = null;

  applyResearchFacts(row, research, mofibo, { existingRow, updateGoodreads });
  const uncertainty = buildUncertaintyProfile(research, assessments);
  const contentMatch = predicted.score;
  const readPriority = calculateReadPriority(row, contentMatch, uncertainty);
  row["Indholdsmatch"] = contentMatch;
  row["Læseprioritet nu"] = readPriority.score;
  assessments["Indholdsmatch"] = {
    ...predicted,
    reason: predicted.reason
      ? `Samme smagsberegning som Tine-score. ${predicted.reason}`
      : "Samme smagsberegning som Tine-score.",
  };
  assessments["Læseprioritet nu"] = {
    score: readPriority.score,
    confidence:
      uncertainty.level === "strong"
        ? "high"
        : uncertainty.level === "medium"
          ? "medium"
          : "low",
    basis: "mixed_sources",
    reason: readPriority.reason,
    evidenceSourceIds: predicted.evidenceSourceIds || [],
    conflictingSourceIds: predicted.conflictingSourceIds || [],
  };

  if (!row["Seriens navn"]) {
    row["Seriens navn"] =
      research?.identity?.series ||
      research?.identity?.title ||
      query;
  }
  if (!row["Første bog/titel"]) {
    row["Første bog/titel"] = research?.identity?.title || query;
  }
  if (!row.Forfatter) {
    row.Forfatter = research?.identity?.author || null;
  }
  if (!row.Status) row.Status = "Ikke læst";

  return { row, assessments, uncertainty, readPriority };
}

function buildAnalysisMeta({
  research,
  assessments,
  uncertainty,
  readPriority,
  parsed,
  usage,
  cacheHit,
  analysisHash,
}) {
  const sources = research?.sources || [];
  const counts = summarizeSourceFoundation(sources);
  const gr = research?.ratings?.goodreads;

  return {
    promptVersion: ANALYSIS_PROMPT_VERSION,
    handbookVersion: HANDBOOK_VERSION,
    model: usage.model || ANALYSIS_MODEL,
    analyzedAt: new Date().toISOString(),
    analysisHash,
    researchHash: research?.meta?.researchHash || null,
    cacheHit: Boolean(cacheHit),
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    estimatedCostUsd: usage.estimatedCostUsd || 0,
    webSearchCalls: research?.meta?.webSearchCalls || 0,
    userMessage:
      parsed?.userMessage ||
      research?.meta?.warnings?.find((w) => String(w).includes("tyndere")) ||
      (research?.meta?.partial
        ? "Analysen blev gennemført, men nogle oplysninger kunne ikke verificeres."
        : null),
    assessments,
    uncertainty,
    readPriority,
    rhysand: assessments["Rhysand-faktoren"] || null,
    evidence: research?.meta?.evidence || null,
    observations: Array.isArray(research?.observations)
      ? research.observations.map((o) => ({
          id: o.id,
          theme: o.theme,
          label: o.label,
          statement: o.statement,
          hasConflict: Boolean(o.hasConflict),
          supportCount: o.supportingSourceIds?.length || 0,
          conflictCount: o.conflictingSourceIds?.length || 0,
          confidence: o.confidence || null,
        }))
      : [],
    foundation: {
      goodreads: gr
        ? {
            value: gr.value,
            ratingCount: gr.ratingCount,
            sourceUrl: gr.sourceUrl,
            fetchedAt: gr.fetchedAt,
          }
        : null,
      ...counts,
      researchedAt: research?.researchedAt || null,
      disclaimer:
        "Kilder er batchet efter romantasy-felter (helteprofil, romance, plot/karakter, helhed). Appen har ikke læst alle anmeldelser — kun et systematisk udvalg.",
    },
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      type: s.type,
      batch: s.batch || null,
    })),
  };
}

/**
 * Fase B: billigere model uden web search.
 */
export async function runHandbookAnalysis({
  research,
  catalog,
  mofibo,
  query,
  existingAnalysisHash = null,
  force = false,
  existingRow = null,
  /** false = genanalyse: rør ikke Goodreads. true = ny analyse/refresh må opdatere fra verificeret research */
  updateGoodreads = true,
}) {
  const anchors = getCalibrationAnchors(5);
  const researchHash = research?.meta?.researchHash || "no-research";
  const analysisHash = analysisInputHash({
    researchHash,
    handbookVersion: HANDBOOK_VERSION,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    model: ANALYSIS_MODEL,
    anchors: anchors.map((a) => [a.serie, a.score, a.scoreSource]),
  });

  if (!force && existingAnalysisHash && existingAnalysisHash === analysisHash) {
    return {
      reused: true,
      analysisHash,
      row: null,
      meta: null,
    };
  }

  const rowOpts = { existingRow, updateGoodreads };

  const key = getOpenAIKey();
  if (!key) {
    const { row, assessments, uncertainty, readPriority } = assessmentsToRow(
      { fields: {}, assessments: {}, predictedTineScore: { score: null } },
      research,
      mofibo,
      query,
      rowOpts
    );
    row["Seriens navn"] =
      research?.identity?.series || research?.identity?.title || query;
    const meta = buildAnalysisMeta({
      research,
      assessments,
      uncertainty,
      readPriority,
      parsed: {
        userMessage:
          "Analysen kunne ikke bruge AI (mangler nøgle). Basisoplysninger er gemt.",
      },
      usage: { model: null },
      cacheHit: false,
      analysisHash,
    });
    return { reused: false, row, meta, analysisHash, fallback: true };
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });
  const prompt = buildAnalysisPrompt({ research, catalog, mofibo, query });

  try {
    const completion = await client.chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: 0,
      top_p: 1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Du er en deterministisk håndbogs-analytiker. Samme input → samme JSON. Ingen web search. Svar kun med ét JSON-objekt. Sæt aldrig Goodreads fra Open Library eller Google Books. Når du scorer et felt: Hvis mindst én kilde beskriver det fænomen feltet handler om (også med andre ord), så sæt score, basis source_consensus, evidenceSourceIds og typisk confidence medium. Markér KUN insufficient hvis INGEN kilder beskriver fænomenet. Eksempel: 'han ville dræbe for hende' = belæg for touch-her-and-die.",
        },
        { role: "user", content: prompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content;
    if (!text) throw new Error("Tomt analysesvar");
    let parsed;
    try {
      parsed = extractJson(text);
    } catch (err) {
      console.error("Ugyldigt AI-JSON:", err.message);
      throw new Error("Ugyldigt AI-output");
    }

    // Tving egne felter til null
    parsed.tineOwnScore = null;
    parsed.tineOwnReview = null;
    if (parsed.fields) delete parsed.fields["Goodreads-score"];

    const { row, assessments, uncertainty, readPriority } = assessmentsToRow(
      parsed,
      research,
      mofibo,
      query,
      rowOpts
    );
    const inputTokens = completion.usage?.prompt_tokens || 0;
    const outputTokens = completion.usage?.completion_tokens || 0;
    const meta = buildAnalysisMeta({
      research,
      assessments,
      uncertainty,
      readPriority,
      parsed,
      usage: {
        model: completion.model || ANALYSIS_MODEL,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(
          ANALYSIS_MODEL,
          inputTokens,
          outputTokens
        ),
      },
      cacheHit: false,
      analysisHash,
    });

    console.log(
      `Håndbogsanalyse: ${row["Seriens navn"]} · tokens ${inputTokens}/${outputTokens}`
    );
    return { reused: false, row, meta, analysisHash, fallback: false };
  } catch (err) {
    console.error("Håndbogsanalyse fejl:", err.message);
    const { row, assessments, uncertainty, readPriority } = assessmentsToRow(
      { fields: {}, assessments: {}, predictedTineScore: { score: null } },
      research,
      mofibo,
      query,
      rowOpts
    );
    row["Seriens navn"] =
      research?.identity?.series || research?.identity?.title || query;
    const meta = buildAnalysisMeta({
      research,
      assessments,
      uncertainty,
      readPriority,
      parsed: {
        userMessage:
          "Analysen blev gennemført, men nogle oplysninger kunne ikke verificeres.",
      },
      usage: { model: ANALYSIS_MODEL },
      cacheHit: false,
      analysisHash,
    });
    return {
      reused: false,
      row,
      meta,
      analysisHash,
      fallback: true,
      error: err.message,
    };
  }
}

export {
  SUBJECTIVE_KEYS,
  buildUncertaintyProfile,
  calculateReadPriority,
  estimateTineScoreFromVibes,
  normalizeAssessment,
  applyResearchFacts,
  findPhenomenonSourceIds,
  attachPhenomenonEvidence,
  extractExplicitSourceRatings,
};
